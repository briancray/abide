// RULEBOOK 14: a `Reactive` is tracked only where something downstream will be rebuilt
// from it, and 14.11 has the value push its own subscriber when it evaluates, whoever
// reached it. 14.13 makes tracking SYNCHRONOUS, which is what keeps the cost to one
// variable save and restore rather than a context propagated across every promise in
// the process.
//
// THE READER IS A FIELD ON A MODULE-SCOPE RECORD rather than a module-scope `let` with
// an accessor, so a read can test it INLINE. A read is the hottest path in the design —
// per template slot, per row — and an exported getter puts a call frame in front of the
// null check that skips the work.
//
// SOURCES ARE AN ARRAY AND A CURSOR, not a set rebuilt per run. A body reads the same
// values in the same order on almost every run, so the common shape is "the source at
// the cursor is the one we already had" — a pointer compare and an increment, with no
// set operation at all. The general algorithm is the fallback: the first read that does
// not match detaches everything from the cursor on and rebuilds it.
//
// DIVERGENCE IS SAID BY THE CURSOR, not by a flag beside it. `cursor === sources.length`
// IS the diverged state — a run that diverges truncates to its cursor and appends from
// there, so the two stay equal for the rest of the run and the cursor can never match
// again. The flag that used to carry this was a second field load and a second branch on
// the read path, which is the hottest path in the design.

// THE THREE STATES A READER CAN BE IN, and the whole of push-pull is that there are
// three rather than two. `DIRTY` says a source of mine PRODUCED and I must run.
// `CHECK` says a source of mine may have — something further up produced, and whether
// it reached me is not known until the sources between us have been asked.
//
// Two states cannot carry that distinction, and the distinction is the design: a write
// marks its direct readers `DIRTY` and everything beyond them `CHECK`, so the mark walk
// is O(V) flag writes and runs no body at all. A `CHECK` node asked for its value
// resolves its sources first and runs only where one of them produced — which is what
// keeps 5.2 true through a chain that eager kept by running every body and comparing.
//
// The ORDER matters: a mark never weakens, so `state >= wanted` is the skip test.
// Annotated `number` rather than left as literals on purpose: the field is mutated by a
// resolution the compiler cannot see through, so a literal type would narrow
// `state === CHECK` to `1` and then call the `state === DIRTY` beneath it unreachable.
export const CLEAN: number = 0
export const CHECK: number = 1
export const DIRTY: number = 2

export type Subscriber = {
    notify(): void
    // `CLEAN`, `CHECK` or `DIRTY`. Set on every transitive reader before anything runs,
    // so a body that reads a source the resolution has not reached yet pulls it forward
    // rather than reading a value the write has passed by. `running` is the re-entrancy
    // guard for a body already on the stack.
    state: number
    running: boolean
    isEffect: boolean
    // A MIRROR IS NOT AN EFFECT AND MUST NOT BE BATCHED WITH ONE. An adoption's mirror
    // moves a VALUE — it is the outer value's production, arriving from the inner one —
    // so deferring it to the end of the turn would leave a read between the two answering
    // with what the outer held before, and reads pulling correctly is the whole reason the
    // drain can be deferred at all. It runs in the mark walk, where no body runs and the
    // production it mints marks on through the same walk.
    isMirror: boolean
    // THE VALUE AN ADOPTION'S MIRROR MIRRORS INTO, and `null` on every other reader. A probe
    // move on the adopted value mints nothing, so it never reaches the mirror as a value —
    // this is the edge `markProbes` follows to reach the adopter's guards instead (11.51).
    adopter: Tracked | null
    // Read on the last run, in order. Rebuilt only from the point a run diverges.
    sources: Tracked[]
    // The values whose PROBES this run asked about, which is a different edge from the
    // ones whose values it read (3.3). Kept apart so a flip reaches the readers that
    // asked and nobody else: waking a value reader because a load STARTED is 50 data
    // writes on a 50-row list, every one of them redundant, and the identity gate that
    // exists to stop exactly that cannot see a production nobody minted.
    probeSources: Tracked[]
    // How far into `sources` this run has matched, and once it reaches `sources.length`
    // the run has DIVERGED and every read left goes through `track`. Reset before each run.
    cursor: number
    alive: boolean
}

export type Tracked = {
    readers: Subscriber[]
    // Who asked about this value's probes. Apart from `readers` — see `probeSources`.
    probeReaders: Subscriber[]
}

export const TRACKING: { reader: Subscriber | null } = { reader: null }

// Removal by swap-with-last: order in a reader list is not observable, and a splice is
// O(n) copying where this is one write. Exported because readers are registered OUTSIDE the
// tracking protocol too — a cursor in `History.ts`, an entry's lifetime in `Keyed.ts` — and a
// second copy of the loop beside this one is what CLAUDE.md's sibling-seam rule refuses.
export function dropReader(source: Tracked, reader: Subscriber): void {
    removeFrom(source.readers, reader)
}

// The probe edge's half of the same thing, for a reader registered on it outside a run —
// a `then` waiter, which settles on a probe moving rather than on a value.
export function dropProbeReader(source: Tracked, reader: Subscriber): void {
    removeFrom(source.probeReaders, reader)
}

function removeFrom(readers: Subscriber[], reader: Subscriber): void {
    for (let index = 0; index < readers.length; index += 1) {
        if (readers[index] !== reader) continue
        readers[index] = readers[readers.length - 1] as Subscriber
        readers.pop()
        return
    }
}

// A PROBE EDGE IS REBUILT PER RUN rather than cursored. A body reads few probes where it
// reads many values, and a guard that stops being taken must stop waking — so the list is
// dropped at the start of a run and re-made by the reads that happen.
export function trackProbe(source: Tracked, reader: Subscriber): void {
    const asked = reader.probeSources
    for (let index = 0; index < asked.length; index += 1)
        if (asked[index] === source) return
    asked.push(source)
    source.probeReaders.push(reader)
}

export function detachProbes(reader: Subscriber): void {
    const asked = reader.probeSources
    for (let index = 0; index < asked.length; index += 1)
        removeFrom((asked[index] as Tracked).probeReaders, reader)
    asked.length = 0
}

// Everything from `cursor` on is a value the previous run read and this one has not.
function truncate(reader: Subscriber): void {
    const sources = reader.sources
    for (let index = reader.cursor; index < sources.length; index += 1)
        dropReader(sources[index] as Tracked, reader)
    sources.length = reader.cursor
}

// THE READER IS PASSED IN, not re-read. Every call site has already tested
// `TRACKING.reader` for null to decide whether to call at all, and re-loading it here
// made the null check happen twice on the hottest path in the design.
//
// The STABLE arm — the source at the cursor is the one the last run had — is inlined at
// the call site in `Reactive`, so what is left here is the divergence: this is the
// fallback, reached on the first read a run makes that the previous run did not.
export function track(source: Tracked, reader: Subscriber): void {
    const sources = reader.sources
    const at = reader.cursor
    // THE FIRST DIVERGENCE OF THIS RUN, and the only one that has anything to drop. The
    // truncation leaves `sources.length === cursor` and the append below keeps them
    // equal, so every later read of this run arrives with the test already false — which
    // is the flag this replaced, read off state the cursor was carrying anyway.
    if (at < sources.length) truncate(reader)
    sources.push(source)
    reader.cursor = at + 1
    // Appends happen only after a divergence, so this scan is off the common path. It
    // is what stops a body reading one value twice from waking twice.
    const readers = source.readers
    for (let index = 0; index < readers.length; index += 1)
        if (readers[index] === reader) return
    readers.push(reader)
}

// The tail a run left behind. The TEST that there is one is the caller's — it is two
// field loads, and this is the rare arm.
export function endRun(reader: Subscriber): void {
    truncate(reader)
}

export function detach(reader: Subscriber): void {
    reader.cursor = 0
    truncate(reader)
    if (reader.probeSources.length !== 0) detachProbes(reader)
}
