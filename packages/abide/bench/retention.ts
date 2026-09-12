// TWO CLAIMS OF THE SAME SHAPE, and the shape is why they share a file: each is a
// RATIO between two sizes of one structure rather than a number against a clock, which
// is the one timing claim that stays honest across substrates.
//
// 6.2 — RAISING `tail` MUST NOT MAKE A WRITE DEARER.
// 5.22 — NEITHER MUST RAISING THE SIZE OF THE VALUE, past the bound on the walk 5.2
// gates every production on. `REACTIVE.md`'s budget table carried this row as "not
// taken" and predicted it might exceed the whole graph walk: unbounded it was 663 µs
// at 20,000 rows against a 40 ns graph walk, so it did, by four orders of magnitude.
//
// IT CANNOT RUN IN THE GATE, and that is a property of the instrument rather than a
// preference. `batch()` throws in a parallel worker (44.18) and `bun run test` is
// `--parallel`; `measure`'s `time()` sets `emulated: 'dom'` wherever `document` is
// defined and `bunfig.toml` preloads happy-dom into every `bun test` process, so a
// ring write that touches no DOM would be refused anyway (44.11, 44.12). So it is a
// workspace script — `bun run bench:retention` — reaching `harness/report`'s batcher
// directly.
//
// THE THRESHOLD IS THE MEASURED FLOOR, not a hard-coded 1.05x. `ratio()` hands back
// `underTheFloor` where the value sits inside the A/A spread it measured for this
// case on this machine today, so a constant is either redundant or unreachable.
//
// REVERT: rebuild the retention per write — `this.values = [value, ...this.values]`
// in `Ring.push` rather than the indexed write into the pre-allocated buffer.
// REPORTS: ~1000x at `tail: 4096` against `tail: 4`, where this asks for a value
// inside the floor.

import { batch, ratio } from 'harness/report'
import { state } from '#shared/index.ts'

const SHALLOW = 4
const DEEP = 65_536

const shallow = state(0, { tail: SHALLOW })
const deep = state(0, { tail: DEEP })

let written = 0

const batched = batch({
    case: `ring write, tail ${SHALLOW} against tail ${DEEP}`,
    emulated: null,
    // THIRTY-ONE REPS, AND THE DEFAULT SEVEN IS WHY THIS CASE USED TO CRY WOLF. A write
    // is 14 ns, `nanoseconds` is min-of-reps, and seven minima of a 14 ns op left the
    // two arms disagreeing by up to 35% — it read 1.120x, 0.892x and 0.939x on three
    // consecutive runs, failing about one run in four with nothing wrong. At 31 the
    // measured A/A floor is 0.01-0.46% and the arms agree inside 3%.
    reps: 31,
    arms: {
        [`tail ${SHALLOW}`]: () => {
            written += 1
            shallow.set(written)
        },
        [`tail ${DEEP}`]: () => {
            written += 1
            deep.set(written)
        },
    },
})

const shallowSample = batched.samples[`tail ${SHALLOW}`]
const deepSample = batched.samples[`tail ${DEEP}`]
if (shallowSample === undefined || deepSample === undefined)
    throw new Error('both arms have to have produced a sample')

const result = ratio(deepSample, shallowSample, { floor: batched.floor })

console.log(
    `n=${batched.n} reps=${batched.reps} floor=${(batched.floor * 100).toFixed(2)}%`,
)
console.log(`tail ${SHALLOW}: ${shallowSample.nanoseconds.toFixed(1)} ns/write`)
console.log(`tail ${DEEP}:    ${deepSample.nanoseconds.toFixed(1)} ns/write`)
console.log(
    `ratio: ${result.kind === 'ratio' ? `${result.value.toFixed(3)}x` : result.kind}`,
)

let failed = false

// A MULTIPLE RATHER THAN THE MEASURED FLOOR, and both halves of that were arrived at
// the wrong way round first. Held to "any ratio at all rather than `underTheFloor`" the
// case failed about one run in four on its own; the first fix was to raise the
// threshold, and it still failed two runs in four at 1.25x. The threshold was not the
// problem — the REPS were, and the fix is above.
//
// What is left over needs a number anyway, because at 31 reps the A/A floor is a
// fraction of a percent and two arms that agree inside 3% are still "a ratio". 1.10x is
// that 3% with room, and it is nowhere near the thing being caught: the REVERT —
// `this.values = [value, ...this.values]` in `Ring.push` — reports ~1000x. This gate
// catches retention being REBUILT per write rather than appended to, which is
// asymptotic, so two orders of magnitude of margin cost nothing.
//
// The claim is now stronger than the one this file started with, because the same reps
// bought a wider range: per-write cost measured FLAT from tail 4 to tail 65,536 — 14.2,
// 14.2, 14.2, 14.6, 14.2 ns at 4, 64, 1024, 4096, 65536 — so a 16,384x range of
// retention and no cache penalty at 1.5 MB of ring. A push touches one slot and
// advances by one, which is the access pattern a prefetcher is for.
const REBUILT = 1.1

if (result.kind === 'ratio' && result.value > REBUILT) {
    console.error(
        `6.2: raising \`tail\` from ${SHALLOW} to ${DEEP} moved the per-write cost to ${result.value.toFixed(3)}x, past ${REBUILT}x. Retention is being rebuilt rather than appended to.`,
    )
    failed = true
}

// ----- 5.22: the second case, and the row the plan carried as not taken -------------
//
// THE ARMS ARE TWO SIZES OF ONE VALUE. Both writes are accepted, so both pay the ring
// push and the wake, and the only thing that differs between them is how much value
// there is to walk. With the bound in, the walk stops at the same visit count either
// way and the ratio is flat; with it out, the ratio is the size ratio.
//
// REVERT: `VISIT_BUDGET = Number.POSITIVE_INFINITY` in `comparator.ts`. REPORTS ~2x
// here, and 663 µs against 46 per write at 20,000 rows.
const SMALL = 10_000
const LARGE = 20_000

type Row = { id: number; label: string }
const rows = (count: number, mark: boolean): Row[] =>
    Array.from({ length: count }, (_, at) => ({
        id: at,
        // The difference is in the LAST row, which is the walk's worst case: every
        // earlier row compares equal, so nothing short-circuits before the end.
        label: mark && at === count - 1 ? 'changed' : `row ${at}`,
    }))

const smallRows = [rows(SMALL, false), rows(SMALL, true)] as const
const largeRows = [rows(LARGE, false), rows(LARGE, true)] as const
const small = state(smallRows[0] as Row[])
const large = state(largeRows[0] as Row[])
// THE THIRD ARM IS REPORTED AND NOT GATED — `REACTIVE.md` asks for the same structure
// with `identity` declared, and what it answers is not an invariant but the price of
// the default: this is the same write with the walk opted out of.
const projected = state(largeRows[0] as Row[], {
    identity: (held: Row[]) => held[held.length - 1]?.label,
})

let written2 = 0
const walked = batch({
    case: 'write of a 10,000-row value against a 20,000-row one',
    emulated: null,
    // The same reason as above, and this op is 77 µs rather than 14 ns — but the reps
    // are cheap and a gate that has ever cried wolf is read as noise forever.
    reps: 31,
    arms: {
        [`${SMALL} rows`]: () => {
            written2 += 1
            small.set(smallRows[written2 & 1] as Row[])
        },
        [`${LARGE} rows`]: () => {
            written2 += 1
            large.set(largeRows[written2 & 1] as Row[])
        },
        [`${LARGE} rows, identity declared`]: () => {
            written2 += 1
            projected.set(largeRows[written2 & 1] as Row[])
        },
    },
})

const smallSample = walked.samples[`${SMALL} rows`]
const largeSample = walked.samples[`${LARGE} rows`]
if (smallSample === undefined || largeSample === undefined)
    throw new Error('both arms have to have produced a sample')

const walkResult = ratio(largeSample, smallSample, { floor: walked.floor })

console.log('')
console.log(
    `n=${walked.n} reps=${walked.reps} floor=${(walked.floor * 100).toFixed(2)}%`,
)
console.log(
    `${SMALL} rows: ${(smallSample.nanoseconds / 1000).toFixed(1)} µs/write`,
)
console.log(
    `${LARGE} rows: ${(largeSample.nanoseconds / 1000).toFixed(1)} µs/write`,
)
console.log(
    `ratio: ${walkResult.kind === 'ratio' ? `${walkResult.value.toFixed(3)}x` : walkResult.kind}`,
)
const projectedSample = walked.samples[`${LARGE} rows, identity declared`]
if (projectedSample !== undefined)
    console.log(
        `${LARGE} rows with \`identity\` declared: ${projectedSample.nanoseconds.toFixed(0)} ns/write — what the default's walk costs, against opting out of it`,
    )

// A DOUBLING THAT SHOWS UP AS A DOUBLING is the failure; anything inside the measured
// A/A spread is the bound holding. The threshold is the floor rather than a constant,
// for the same reason the case above uses it.
if (walkResult.kind === 'ratio' && walkResult.value > REBUILT) {
    console.error(
        `5.22: doubling the value from ${SMALL} to ${LARGE} rows moved the per-write cost to ${walkResult.value.toFixed(3)}x, past ${REBUILT}x. The walk is not bounded, so the duplicate gate scales with the value.`,
    )
    failed = true
}

if (failed) process.exit(1)
