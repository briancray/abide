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

/**
 * The first of the three states a reader can be in: nothing it read has moved.
 *
 * THE THREE STATES A READER CAN BE IN, and the whole of push-pull is that there are three rather
 * than two. `DIRTY` says a source of mine PRODUCED and I must run. `CHECK` says a source of mine
 * may have — something further up produced, and whether it reached me is not known until the
 * sources between us have been asked.
 *
 * Two states cannot carry that distinction, and the distinction is the design: a write marks its
 * direct readers `DIRTY` and everything beyond them `CHECK`, so the mark walk is O(V) flag writes
 * and runs no body at all. A `CHECK` node asked for its value resolves its sources first and runs
 * only where one of them produced — which is what keeps 5.2 true through a chain that eager kept
 * by running every body and comparing.
 *
 * The ORDER matters: a mark never weakens, so `state >= wanted` is the skip test. Annotated
 * `number` rather than left as literals on purpose: the field is mutated by a resolution the
 * compiler cannot see through, so a literal type would narrow `state === CHECK` to `1` and then
 * call the `state === DIRTY` beneath it unreachable.
 */
export const CLEAN: number = 0
/** A source of mine may have produced; ask the sources between us before running. See `CLEAN`. */
export const CHECK: number = 1
/** A source of mine produced, and I must run. See `CLEAN`. */
export const DIRTY: number = 2

export type Subscriber = {
    notify(): void
    /**
     * `CLEAN`, `CHECK` or `DIRTY`.
     *
     * Set on every transitive reader before anything runs, so a body that reads a source the
     * resolution has not reached yet pulls it forward rather than reading a value the write has
     * passed by.
     */
    state: number
    /** The re-entrancy guard for a body already on the stack. */
    running: boolean
    isEffect: boolean
    /**
     * Whether this reader runs in the mark walk rather than the drain.
     *
     * A MIRROR RUNS IN THE MARK WALK, NOT THE DRAIN, and must not be batched with an effect. An
     * adoption's mirror moves a VALUE — it is the outer value's production, arriving from the inner
     * one — so deferring it to the end of the turn would leave a read between the two answering
     * with what the outer held before, and reads pulling correctly is the whole reason the drain
     * can be deferred at all. A keyed entry's lifetime is the one mirror with no adopter: it runs
     * in the walk so its clock read is the production's own moment.
     */
    isMirror: boolean
    /**
     * The value an adoption's mirror mirrors into, and `null` on every other reader.
     *
     * A probe move on the adopted value mints nothing, so it never reaches the mirror as a value —
     * this is the edge `markProbes` follows to reach the adopter's guards instead (11.50).
     */
    adopter: Tracked | null
    /** Read on the last run, in order. Rebuilt only from the point a run diverges. */
    sources: Tracked[]
    /**
     * The values whose PROBES this run asked about — another edge than the values it read (3.3).
     *
     * Kept apart so a flip reaches the readers that asked and nobody else: waking a value reader
     * because a load STARTED is 50 data writes on a 50-row list, every one of them redundant, and
     * the identity gate that exists to stop exactly that cannot see a production nobody minted.
     */
    probeSources: Tracked[]
    /**
     * How far into `probeSources` this run has re-asked — `cursor` for the probe edge, and see
     * `trackProbe` for why it is not the same protocol.
     */
    probeCursor: number
    /**
     * How far into `sources` this run has matched.
     *
     * Once it reaches `sources.length` the run has DIVERGED and every read left goes through
     * `track`. Reset before each run.
     */
    cursor: number
    /**
     * The distinct values in `sources[0..seenThrough)` once `track` has found them worth a set;
     * `null` until a body reads that many. See `track`.
     */
    seen: Set<Tracked> | null
    /** The cursor after this reader's last read `track` deduped past `SET_OVER_SCAN`. */
    seenThrough: number
    /**
     * Where the stretch of diverged reads `seenThrough` ends began, while it is still being
     * scanned — and `-1` once `seen` is what answers for it.
     */
    scanningFrom: number
    alive: boolean
}

export type Tracked = {
    readers: Subscriber[]
    /** How many of `readers` are disposed and not yet swept out — see `dropFrom`. */
    deadReaders: number
    /** Who asked about this value's probes. Apart from `readers` — see `probeSources`. */
    probeReaders: Subscriber[]
    /** `deadReaders` for `probeReaders`. */
    deadProbeReaders: number
}

/** A node that is nothing but its edges — a probe signal with no value behind it. */
export function newTracked(): Tracked {
    return {
        readers: [],
        deadReaders: 0,
        probeReaders: [],
        deadProbeReaders: 0,
    }
}

/** The reader whose run is on the stack, or `null` where reads subscribe to nothing. */
export const TRACKING: { reader: Subscriber | null } = { reader: null }

function unwired(): void {}

/**
 * A fresh reader over `sources`, its `notify` left for the caller to assign.
 *
 * ONE PLACE THE SHAPE IS WRITTEN for every reader in this graph that is not a `Cell`: the tracked
 * effect and the narrowed one in `watch.ts`, a history cursor, the waiter a `then` parks on a
 * probe edge, and a keyed entry's lifetime mirror.
 *
 * THE FIELD ORDER IS THE PART NO TEST CATCHES. TypeScript refuses a literal that MISSES a field, so
 * copies could not diverge in content — but it says nothing about the order they are written in,
 * and each order is its own hidden class for one type. Every `reader.state` and `reader.alive` on
 * the mark walk is then a polymorphic load, and nothing about the output moves.
 *
 * `notify` IS ASSIGNED BY THE CALLER, which is a write to a field that is already there and so
 * leaves the shape alone — each reader's closes over the reader itself, which a factory parameter
 * cannot do without a second frame on every wake.
 */
export function newSubscriber(
    sources: Tracked[],
    adopter: Tracked | null,
    isMirror: boolean = adopter !== null,
): Subscriber {
    return {
        sources,
        probeSources: [],
        probeCursor: 0,
        cursor: 0,
        seen: null,
        seenThrough: 0,
        scanningFrom: -1,
        alive: true,
        state: CLEAN,
        running: false,
        isEffect: true,
        isMirror,
        adopter,
        notify: unwired,
    }
}

/**
 * Removes `reader` from `source`'s readers.
 *
 * Removal by swap-with-last: order in a reader list is not observable, and a splice is O(n)
 * copying where this is one write. Exported because readers are registered OUTSIDE the tracking
 * protocol too — a cursor in `Cursor.ts`, an entry's lifetime in `Keyed.ts` — and a second copy
 * of the loop beside this one is what CLAUDE.md's sibling-seam rule refuses.
 */
export function dropReader(source: Tracked, reader: Subscriber): void {
    const readers = source.readers
    source.deadReaders = dropFrom(readers, reader, source.deadReaders)
    if (readers.length === 0) unread(source)
}

/**
 * What lets go of a value whose owner has stopped, once nothing reads it — `Reactive.ts`'s, set
 * there because this module cannot import it.
 */
export const RELEASING: { unread: ((source: Tracked) => void) | null } = {
    unread: null,
}

/**
 * Hands a value that has just lost its last reader on to `RELEASING`, where its owner has stopped.
 *
 * 12.14 — see `orphan` in `Reactive.ts`. Only a `Cell` carries `orphaned`, so
 * every other source answers `undefined` and stops here.
 */
function unread(source: Tracked): void {
    if ((source as { orphaned?: boolean }).orphaned !== true) return
    if (source.readers.length !== 0 || source.probeReaders.length !== 0) return
    RELEASING.unread?.(source)
}

/**
 * Calls `run` with no reader on the stack, restoring the reader however it exits.
 *
 * 4.7's frame. Arguments rather than a closure, so a caller on a per-write path allocates nothing
 * to use it.
 */
export function untracked<First, Second, Result>(
    run: (first: First, second: Second) => Result,
    first: First,
    second: Second,
): Result {
    const previous = TRACKING.reader
    TRACKING.reader = null
    try {
        return run(first, second)
    } finally {
        TRACKING.reader = previous
    }
}

/**
 * Removes `reader` from `source`'s probe readers — `dropReader` for the probe edge.
 *
 * For a reader registered on it outside a run — a `then` waiter, which settles on a probe moving
 * rather than on a value.
 */
export function dropProbeReader(source: Tracked, reader: Subscriber): void {
    const readers = source.probeReaders
    source.deadProbeReaders = dropFrom(readers, reader, source.deadProbeReaders)
    if (readers.length === 0) unread(source)
}

/**
 * Takes `reader` off `readers`, of which `dead` are disposed, and returns how many are now.
 *
 * A DISPOSED READER IS LEFT WHERE IT IS AND COUNTED, rather than found. Finding it is a scan of
 * every reader of the value, and a teardown drops them all — n rows reading one page value, torn
 * down, paid n²/2 compares, and a keyed replace is the worst order there is: the new rows are
 * pushed behind the old ones the scan walks past. 10,000 rows went 16-39 ms to 0.2-0.4. Every
 * walk over a reader list skips `!alive`, so a dead slot costs a walk one test until the
 * sweep below takes it out.
 *
 * SWEPT ONCE HALF THE LIST IS DEAD, which keeps a walk to at most twice the live readers and the
 * sweep amortized O(1) a drop — and keeps the invariant every `length` test leans on: a list with
 * entries has a LIVE one, since a list that is all dead is at least half dead. HALF, NOT MORE THAN
 * HALF: a keyed replace ends on exactly half, n old rows dead behind n new ones, and a sweep that
 * waited for one more drop kept the old rows — and through each one's `notify`, its scope and its
 * nodes — reachable until some unrelated reader left. An over-count — a
 * reader dropped twice — only sweeps early, and the sweep recounts from zero.
 *
 * A LIVE reader still scans: that is a run's own truncation or an orphan's release, a reader
 * that may subscribe again, so it cannot be left to read as dead.
 */
function dropFrom(
    readers: Subscriber[],
    reader: Subscriber,
    dead: number,
): number {
    if (!reader.alive) dead += 1
    else purge(readers, reader)
    if (dead * 2 < readers.length) return dead
    let kept = 0
    for (let index = 0; index < readers.length; index += 1) {
        const survivor = readers[index] as Subscriber
        if (survivor.alive) {
            readers[kept] = survivor
            kept += 1
        }
    }
    readers.length = kept
    return 0
}

/**
 * Subscribes `reader` to `source`'s probes, once per run.
 *
 * A PROBE EDGE IS CURSORED, and kept in the order this run asked. `probeSources[0..probeCursor)`
 * is what this run has asked so far; a source asked again is moved to the cursor rather than
 * dropped and re-pushed, so a run that asks what its last one did touches no source's list at
 * all. It used to be dropped at the start of every run and re-made — which put a scan of the
 * SOURCE'S probe readers behind every rerun, and n guards over one shared `ready()` woken by one
 * flip paid n²: 10,000 went 39 ms to 0.4. A guard that stops being taken still stops waking:
 * what the run did not re-ask is past the cursor at its end, and `truncateProbes` drops it.
 *
 * NOT `track`'s protocol, because the list is a SET in no particular order where `sources` is
 * positional: a re-ask out of order is a swap, never a divergence, and a body asks one to three.
 */
export function trackProbe(source: Tracked, reader: Subscriber): void {
    const asked = reader.probeSources
    const at = reader.probeCursor
    if (asked[at] === source) {
        reader.probeCursor = at + 1
        return
    }
    for (let index = 0; index < at; index += 1)
        if (asked[index] === source) return
    let found = asked.length
    for (let index = at + 1; index < asked.length; index += 1)
        if (asked[index] === source) {
            found = index
            break
        }
    if (found === asked.length) {
        asked.push(source)
        source.probeReaders.push(reader)
    }
    asked[found] = asked[at] as Tracked
    asked[at] = source
    reader.probeCursor = at + 1
}

/** Drops the probe subscriptions `reader`'s run did not re-ask — the tail past its cursor. */
export function truncateProbes(reader: Subscriber): void {
    const asked = reader.probeSources
    for (let index = reader.probeCursor; index < asked.length; index += 1)
        dropProbeReader(asked[index] as Tracked, reader)
    asked.length = reader.probeCursor
}

/** Drops every probe subscription `reader` holds. */
export function detachProbes(reader: Subscriber): void {
    reader.probeCursor = 0
    truncateProbes(reader)
}

// How far `kept * dropped` must outgrow `kept + dropped` before `truncate` builds a `Set` over the
// kept prefix rather than scanning it once per dropped slot.
const SET_OVER_SCAN = 20

/**
 * Drops `reader`'s sources from its cursor on, unsubscribing each the kept prefix no longer lists.
 *
 * Everything from `cursor` on is a value the previous run read and this one has not.
 *
 * A SLOT IS NOT A SUBSCRIPTION. `sources` is POSITIONAL — one slot per read, so a body that reads
 * one value twice holds two slots for it — where `source.readers` is a SET, deduped by `track`.
 * Dropping per slot therefore unsubscribed a value a SURVIVING slot still lists, and the shorter
 * run is what did it: `reactive(() => name() ? name().toUpperCase() : 'anon')` reads `name` twice
 * on the truthy run and once on the falsy one, so the falsy run's truncation took the whole
 * subscription with it and the value never recomputed again — right at the moment it looked
 * right. The kept prefix is what says whether this slot was the last of its value.
 *
 * THE SCAN RUNS PER DROPPED SLOT, so what it costs is kept x dropped: a body reading 1000 values
 * on its wide branch and 500 on its narrow one paid 250,000 pointer compares on every flip — 9.3x
 * the pre-change truncate, +105 us a flip, which crosses a frame at six. A `Set` over the kept
 * prefix is the O(kept + dropped) form and is taken WHERE IT WINS rather than always (past
 * `SET_OVER_SCAN`): at 1000/999 the scan is one probe per dropped slot and building the Set
 * doubled the flip, so the two are priced against each other instead.
 *
 * A duplicate inside the DROPPED tail needs no test — `dropFrom` takes one occurrence and the
 * second call finds none, or for a disposed reader counts one dead too many, which only sweeps
 * early.
 *
 * Exported because a tracked run's end is exactly this and nothing more: the TEST that there is a
 * tail is the caller's — two field loads, on the rare arm.
 */
export function truncate(reader: Subscriber): void {
    const sources = reader.sources
    const kept = reader.cursor
    const dropped = sources.length - kept
    if (dropped === 0) return
    if (kept * dropped > (kept + dropped) * SET_OVER_SCAN) {
        const survives = new Set<Tracked>()
        for (let index = 0; index < kept; index += 1)
            survives.add(sources[index] as Tracked)
        for (let index = kept; index < sources.length; index += 1) {
            const source = sources[index] as Tracked
            if (survives.has(source)) continue
            dropReader(source, reader)
        }
        sources.length = kept
        return
    }
    for (let index = kept; index < sources.length; index += 1) {
        const source = sources[index] as Tracked
        if (stillRead(sources, source, kept)) continue
        dropReader(source, reader)
    }
    sources.length = kept
}

function stillRead(sources: Tracked[], source: Tracked, kept: number): boolean {
    for (let index = 0; index < kept; index += 1)
        if (sources[index] === source) return true
    return false
}

/**
 * Records a read of `source` by `reader` where its run has diverged from the last one.
 *
 * THE READER IS PASSED IN, not re-read. Every call site has already tested `TRACKING.reader` for
 * null to decide whether to call at all, and re-loading it here made the null check happen twice
 * on the hottest path in the design.
 *
 * The STABLE arm — the source at the cursor is the one the last run had — is inlined at the call
 * site in `Reactive`, so what is left here is the divergence: this is the fallback, reached on the
 * first read a run makes that the previous run did not.
 */
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
    // WHAT STOPS A BODY READING ONE VALUE TWICE FROM HOLDING TWO SUBSCRIPTIONS, asked of
    // THIS READER'S sources rather than of the source's readers. The two answer the same
    // question — `track` is the only thing that appends to either, and `truncate` drops from
    // both in lockstep, so after it `sources[0..cursor)` IS the set this reader is
    // subscribed to — and they cost differently: the kept prefix is as long as what this
    // BODY reads (1-5), where `source.readers` is as long as the number of READERS on the
    // value.
    //
    // SO THE SCAN WAS QUADRATIC IN THE ROW COUNT. A fresh reader is on this path, not only a
    // diverging one: `Reactive`'s inlined stable arm tests `reader.sources[0] === cell`
    // against an empty array, misses, and lands here. n rows each reading one shared value —
    // `class:selected={selected() === item.id}`, the canonical shape — paid n²/2 pointer
    // compares to mount. Measured under JSC, per reader: 446 ns at n=500 rising to 3,872 ns
    // at n=8000, so mounting crossed a frame at n≈4,000. Asked this way it is ~60 ns FLAT and
    // n=8000 goes 30.98 ms -> 0.45 ms. `mountingIsLinear` in `benchReactive.ts` is what holds the
    // SLOPE (16 readers against 112, calibrated bar), `mount 50 readers on one value` holds the
    // constant, and the subscription count in `reactive.test.ts` holds the dedup this replaced.
    //
    // THE THREE READERS REGISTERED ON A VALUE EDGE OUTSIDE THE PROTOCOL are unaffected, and this
    // asks nothing of them they were not already under: `Cursor`, `Keyed`'s lifetime
    // mirror and the narrowed `watch(sources, effect)` each DECLARE their sources and push
    // themselves onto those sources' readers, so the two agree by construction — `settled`'s
    // waiter is the fourth, and it is on the probe edge, which this never scans — and none of them
    // tracks, which `truncate` already depends on. A cursor of 0 against a declared `sources`
    // would have it drop the declared subscription on the first `track`, so a reader that
    // both declares and tracks is already broken above this line.
    //
    // AND THE SCAN IS QUADRATIC IN THE BODY past the first divergence, which is the same bug one
    // level in: a body summing a thousand rows' values that diverges near the front — a row
    // inserted at index 0 — scans the kept prefix once per read for the rest of the run, n²/2
    // compares, 131 ms at n=16,000 under JSC. So a long STRETCH of diverged reads over a long
    // prefix dedups against a `Set`, priced against the scan the way `truncate` prices its own:
    // below `SET_OVER_SCAN` on the prefix the scan stays, because a body reads 1-5 values and a set
    // is an allocation; and a stretch is scanned for its first `SET_OVER_SCAN` reads before the set
    // is built, because a body that diverges at its LAST read — a thousand stable reads, then a
    // branch — makes one scan and would pay a thousand inserts for a set it asks once.
    //
    // `seenThrough` IS WHAT SAYS THE STRETCH GOES ON. Every read past the threshold comes through
    // here and moves it to the cursor after it, so a read arriving anywhere else follows a
    // truncation, a fresh run or a stretch of stable reads — and `sources[0..at)` is then not
    // what `seen` was last true of, so a new stretch starts. The threshold side cannot alias it:
    // a run climbing back from below arrives at `SET_OVER_SCAN` exactly, which `seenThrough`,
    // always one past a read at or above it, never equals.
    if (at < SET_OVER_SCAN) {
        for (let index = 0; index < at; index += 1)
            if (sources[index] === source) return
        source.readers.push(reader)
        return
    }
    if (reader.seenThrough !== at) reader.scanningFrom = at
    reader.seenThrough = at + 1
    let seen = reader.seen
    const from = reader.scanningFrom
    if (from !== -1) {
        if (at - from < SET_OVER_SCAN) {
            for (let index = 0; index < at; index += 1)
                if (sources[index] === source) return
            source.readers.push(reader)
            return
        }
        if (seen === null) {
            seen = new Set()
            reader.seen = seen
        } else seen.clear()
        for (let index = 0; index < at; index += 1)
            seen.add(sources[index] as Tracked)
        reader.scanningFrom = -1
    }
    const deduped = seen as Set<Tracked>
    if (deduped.has(source)) return
    deduped.add(source)
    source.readers.push(reader)
}

/** Drops every subscription `reader` holds, value and probe alike. */
export function detach(reader: Subscriber): void {
    reader.cursor = 0
    truncate(reader)
    if (reader.probeSources.length !== 0) detachProbes(reader)
}

/**
 * Lets go of every subscription `reader` holds as a DISPOSAL — counted dead where it stands
 * (`dropFrom`) rather than scanned for — while keeping its lists, so `revive` can find what it left.
 *
 * FOR A RELEASED ORPHAN (12.14): n rows each deriving off one page value, torn down, scanned the
 * page value's readers once a row. The orphan may be read again, which is what `revive` is for —
 * paid by the read that comes back, which is rare, rather than by the release, which is per row.
 */
export function tombstone(reader: Subscriber): void {
    reader.alive = false
    const sources = reader.sources
    for (let index = 0; index < sources.length; index += 1)
        dropReader(sources[index] as Tracked, reader)
    reader.cursor = 0
    const asked = reader.probeSources
    for (let index = 0; index < asked.length; index += 1)
        dropProbeReader(asked[index] as Tracked, reader)
    reader.probeCursor = 0
}

/**
 * Takes a `tombstone`d reader's dead entries out of whatever list has not swept them yet, and
 * makes it live with nothing subscribed — the state a fresh reader starts its run in.
 */
export function revive(reader: Subscriber): void {
    reader.alive = true
    const sources = reader.sources
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index] as Tracked
        if (purge(source.readers, reader)) source.deadReaders -= 1
    }
    sources.length = 0
    const asked = reader.probeSources
    for (let index = 0; index < asked.length; index += 1) {
        const source = asked[index] as Tracked
        if (purge(source.probeReaders, reader)) source.deadProbeReaders -= 1
    }
    asked.length = 0
}

function purge(readers: Subscriber[], reader: Subscriber): boolean {
    for (let index = 0; index < readers.length; index += 1) {
        if (readers[index] !== reader) continue
        readers[index] = readers[readers.length - 1] as Subscriber
        readers.pop()
        return true
    }
    return false
}
