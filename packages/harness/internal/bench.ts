// The measurement half of a bench: how an arm is timed, and what a ratio is allowed to claim.
//
// Nothing here renders. The dogfood package draws the cards; what lives here is the part a claim
// depends on being right — the batch sizing, the median-of-many estimate, and the noise threshold
// under which two arms are simply the same.
//
// Arms are timed INTERLEAVED, one pass over all of them at a time, and that is the load-bearing
// decision. Run to completion in turn, an arm inherits whatever the previous one left behind: the
// same hand-written emitter measured 38.6 ns alone and 8.84 µs after abide's arm had run, which
// turned "abide 2.21x slower" into "abide 121x faster" on the page. Interleaving spreads that drift
// across every arm instead of loading it onto whichever ran second, so whatever polluted one pass
// polluted every arm in it — which is what lets the estimate be a MEDIAN rather than a minimum.
//
// The minimum is one sample and the best one: it describes a window where nothing else on the page
// interrupted, which is not the window anybody's op actually runs in, and it cannot be reproduced by
// asking for more passes — more passes only push it further down. The median is what an op costs,
// and it moves toward an answer as the sample grows rather than away from one. `min` stays beside it
// as evidence, and the distance between the two is what says whether the passes agreed.

import { measureFlush, nodesMade } from './dom.ts'
import { isThenable } from './probes.ts'

export interface Arm {
    label: string
    /** Run once. `i` increases monotonically so an arm can alternate values and defeat caching. */
    run: (i: number) => unknown
    /** Run once before timing starts, outside the measured region. */
    prepare?: () => void
}

export interface Timing {
    /** The MEDIAN across passes — the headline, and what every ratio on the page is taken from. */
    p50: number
    /**
     * How many ops the headline is an average of: `batch × PASSES`, and the sample size behind every
     * other number here. On the page BESIDE them, because a ns/op with no count under it cannot be
     * read at all — and because the count is what catches an arm sized against a world that then
     * changed: `/bench/client`'s first arm calibrated at 125 ns, was 21 µs by the time it ran, and
     * spent nine passes of 320,000 iterations finding out. Nothing about its ns/op was wrong.
     */
    ops: number
    /**
     * The ENDS of the pass distribution, ns per op. `p50` is the headline, so it is not repeated.
     *
     * A `spread` field — median ÷ best — sat here and was dropped rather than kept beside these two:
     * it is exactly `p50 / min`, so it was a third number to hold consistent with the two it is made
     * of, and it compressed a distribution into one figure that only ever warned above a threshold.
     * A reader wanting to know whether the median is the shape of the thing or the shape of a busy
     * machine had nothing to look at. `min` is the quietest pass — the floor this op reaches when
     * nothing interrupts — and `max` is the worst the machine did to it. `NOISY_SPREAD` is still the
     * band, and a caller that wants the warning divides. A p90 sat between them and was dropped too:
     * at nine samples it is interpolated between the eighth and the ninth, so it moves with `max` and
     * answers the same question one column to its left already did.
     */
    min: number
    max: number
    /**
     * DOM nodes made per op — the memory-shaped number, and the only honest one a PAGE can take.
     *
     * Not bytes. `performance.memory` reads 9.5 MB against a renderer holding 2.8 GB, because DOM
     * nodes are not on the JS heap, and no browser exposes the one they are on. A net node count
     * cannot stand in either: detaching a subtree of ten thousand is ONE `remove`, so the counter
     * reads the same whether those nodes are collectable or pinned by a live effect. What is left is
     * what was ALLOCATED per op, which is exact, is the same everywhere, and is one of the three
     * numbers this project already budgets emitted code in.
     */
    nodes: number
}

// Browsers clamp `performance.now` — 1 ms in Safari, 0.1 ms in Chrome — so the batch has to be long
// enough that one quantum is noise. At 40 ms a 1 ms clamp is a 2.5% floor on every number here,
// which is why the ratio is the thing to read and a 1.05× difference is not a difference.
const BATCH_TARGET_MS = 40
const MAX_BATCH = 1 << 22
// Browsers clamp `performance.now`, so a small batch of a fast op reads as 0ms and the naive
// "scale by target ÷ elapsed" then asks for a batch hundreds of times too large — one probe that
// takes ten seconds instead of twelve milliseconds. The growth per probe is capped for that reason.
const MAX_GROWTH = 32
/**
 * How many interleaved passes over the whole arm list. Each pass is one batch per arm.
 *
 * Nine rather than five, and the difference is reproducibility rather than precision. `p50 ÷ min`
 * says whether the passes within ONE run agreed; it cannot say whether the run agrees with the next,
 * and a card that reads 2.84× and then 4.77× with nothing changed supports no claim in either
 * direction. At five passes that card swung 68% between runs; at nine it swings 4%. A median needs
 * an odd count and enough of them that one interrupted pass cannot be the middle one, and an arm
 * that awaits per op — thirty thousand microtasks in a batch — is interrupted more often than most.
 */
const PASSES = 9
/**
 * How far off `BATCH_TARGET_MS` a pass may land before its batch is resized.
 *
 * A batch is sized once, against the world as it stood before any arm had run — and that world moves.
 * One bench took TWO MINUTES for want of this: its first arm writes a state that a later arm's lazy
 * fixture mounts a thousand-row list onto, so the arm calibrated at 125 ns an op, was 21 µs an op by
 * the time it was measured, and spent nine passes of 320,000 iterations discovering it. The sample
 * stays honest either way — it is elapsed ÷ ops whatever the batch — so what the resize buys back is
 * wall clock, and in the other direction accuracy: a batch that has become too SMALL is a sample
 * approaching the clock's own resolution, which is the one thing no number of passes can fix.
 */
const RESIZE_BEYOND = 4

async function runBatch(arm: Arm, count: number, offset: number): Promise<number> {
    const started = performance.now()
    for (let i = 0; i < count; i++) {
        const produced = arm.run(offset + i)
        if (isThenable(produced)) await produced
    }
    return performance.now() - started
}

/** Grow a batch until it takes about `BATCH_TARGET_MS`, so one clock quantum is noise. */
async function calibrate(arm: Arm, offset: number): Promise<{ batch: number; offset: number }> {
    let batch = 1
    for (;;) {
        const elapsed = await runBatch(arm, batch, offset)
        offset += batch
        if (elapsed >= BATCH_TARGET_MS || batch >= MAX_BATCH) return { batch, offset }
        // Grow toward the target rather than doubling blindly, so a fast op reaches its batch size
        // in a few probes instead of twenty — but never by more than MAX_GROWTH at once.
        const growth = Math.min(MAX_GROWTH, Math.max(2, BATCH_TARGET_MS / Math.max(elapsed, 0.05)))
        batch = Math.min(MAX_BATCH, Math.ceil(batch * growth))
    }
}

/**
 * The middle of a list, averaging the two middle entries when there is an even count.
 *
 * Sorts a COPY rather than asking the caller for a sorted one: a "must be sorted" parameter is a
 * precondition nothing checks, and a caller that forgets it gets a wrong median with no error.
 */
function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b)
    const at = (sorted.length - 1) / 2
    const below = Math.floor(at)
    const above = Math.ceil(at)
    if (below === above) return sorted[below] as number
    return ((sorted[below] as number) + (sorted[above] as number)) / 2
}

/**
 * Time every arm of one bench, interleaved.
 *
 * `settle` is handed in rather than defaulted so the CALLER picks the yield: the browser card waits
 * for a frame, a headless smoke run yields nothing. `frame` lives below and reads the DOM, so this
 * is a choice the caller makes rather than a constraint on the file.
 */
export async function timeArms(arms: Arm[], settle: () => Promise<void>): Promise<Timing[]> {
    const state = await measureArms(arms, settle, PASSES)

    const timings: Timing[] = []
    for (const entry of state) {
        // One counted op per arm, AFTER the timing and outside it: the counters are patched DOM
        // methods, so counting inside the measured passes would put the tax in the number the passes
        // exist to take. One op is enough because this is an allocation count, not a sample — and
        // for the same reason no `settle()` follows it: an allocation count is exact whatever the
        // engine is doing, so quiescing here bought nothing and cost a full `quiesce` per arm.
        // `measureFlush` ticks either side of the write, which is what drains an async arm's op.
        const counts = await measureFlush(() => void entry.arm.run(entry.offset++))

        timings.push({
            p50: median(entry.samples) * 1e6,
            ops: entry.ops,
            min: Math.min(...entry.samples) * 1e6,
            max: Math.max(...entry.samples) * 1e6,
            nodes: nodesMade(counts),
        })
    }
    return timings
}

interface Measured {
    arm: Arm
    batch: number
    /** Where the next op's `i` continues from, so the counted op does not repeat a timed one. */
    offset: number
    /** Every op run under timing, across all passes — the batch may have been resized between them. */
    ops: number
    /** Milliseconds per op, one entry per pass. */
    samples: number[]
}

/** Calibrate every arm, then time them interleaved for `passes` passes. */
async function measureArms(arms: Arm[], settle: () => Promise<void>, passes: number): Promise<Measured[]> {
    const state = arms.map((arm) => ({ arm, batch: 1, ops: 0, offset: 3, samples: [] as number[] }))

    // EVERY arm is prepared and warmed before ANY of them is sized, which is not tidiness: an arm
    // that builds its fixture on first use — a mounted list, a cache, a socket — changes what the
    // arms BESIDE it cost, and one sized ahead of that is sized against a world that no longer
    // exists. Warming all of them first is what makes the first calibration measure the same world
    // the ninth pass will.
    for (const entry of state) {
        entry.arm.prepare?.()
        await runBatch(entry.arm, 3, 0) // warm the JIT and any first-call caches
    }

    for (const entry of state) {
        const calibrated = await calibrate(entry.arm, entry.offset)
        entry.batch = calibrated.batch
        entry.offset = calibrated.offset
        await settle()
    }

    for (let pass = 0; pass < passes; pass++) {
        for (const entry of state) {
            const elapsed = await runBatch(entry.arm, entry.batch, entry.offset)
            entry.offset += entry.batch
            entry.ops += entry.batch
            entry.samples.push(elapsed / entry.batch)
            // See RESIZE_BEYOND. The sample above is kept — it is a per-op number and stays true at
            // any batch size — and only what the NEXT pass will cost is corrected.
            if (elapsed > BATCH_TARGET_MS * RESIZE_BEYOND || elapsed * RESIZE_BEYOND < BATCH_TARGET_MS) {
                const scaled = Math.round((entry.batch * BATCH_TARGET_MS) / Math.max(elapsed, 0.05))
                entry.batch = Math.min(MAX_BATCH, Math.max(1, scaled))
            }
            await settle()
        }
    }

    return state
}

/**
 * Nanoseconds per op for each arm — what a `run` body needs to make a timing claim without a bench
 * card around it.
 *
 * A fixed loop cannot make that claim: browsers clamp `performance.now` to 1 ms in Safari, so twenty
 * thousand publishes read as 0 ms and a ratio between two arms that both read 0 is `NaN`, which
 * fails the assertion for a reason that has nothing to do with the code under it. The batch is
 * calibrated to `BATCH_TARGET_MS` here exactly as a bench arm's is, and the arms are interleaved for
 * the same reason — whichever ran second would otherwise inherit what the first left behind.
 *
 * The MEDIAN of three, which is the same metric a bench card quotes — a `run` and the row beside it
 * must not be two different numbers. Three passes rather than nine because a `run` asserts a bound
 * loose enough to survive a noisy pass where a card prints the number itself, and a median of three
 * already rejects one interrupted pass in either direction.
 */
export async function nsPerOp(arms: Arm[], settle: () => Promise<void> = frame): Promise<number[]> {
    const state = await measureArms(arms, settle, 3)
    return state.map((entry) => median(entry.samples) * 1e6)
}

/** The smallest non-zero step this clock will report — the noise floor under every row. */
export function clockResolution(): number {
    let smallest = Infinity
    for (let i = 0; i < 5_000; i++) {
        const started = performance.now()
        let spin = 0
        for (let j = 0; j < 32; j++) spin += j
        const elapsed = performance.now() - started
        // `spin` is CONSUMED, the same way `quiesce`'s sum is and for the same reason: an engine that
        // can prove the loop's result unobserved can delete the loop, and there would then be nothing
        // between the two clock reads. Never false — it is a fence, not a condition.
        if (spin < 0) throw new Error('unreachable')
        if (elapsed > 0 && elapsed < smallest) smallest = elapsed
    }
    return Number.isFinite(smallest) ? smallest : 0
}

/**
 * The two microtask turns a batched write needs before its effect has run.
 *
 * Every arm that measures "write, then let the flush deliver it" ends with this, which means it is
 * measuring the HARNESS as well as the code: two awaits in an async arm cost about 430 ns, against
 * a hand-written store's synchronous notify at 20 ns. A bench that does not say so reports 42×
 * where the truth is nearer 21×, so `TimeBench.floor` puts this on the card as its own row.
 */
export const settled = async (): Promise<void> => {
    await Promise.resolve()
    await Promise.resolve()
}

/** The floor arm itself: the same two awaits, measuring nothing. */
export const FLOOR: Arm = {
    label: 'the harness floor — two microtask turns, measuring nothing',
    run: settled,
}

export function duration(ns: number): string {
    if (ns < 1_000) return `${ns.toFixed(ns < 100 ? 1 : 0)} ns`
    if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} µs`
    return `${(ns / 1_000_000).toFixed(2)} ms`
}

/** Under this much difference the two arms are the same and the row should say so. */
export const NOISE = 0.05

/** Above this, most passes were polluted and the row should say the run was noisy. */
export const NOISY_SPREAD = 1.5

/** Faster · same · slower, as a bucket the caller can style. */
export function verdict(abide: number, arm: number): 'faster' | 'same' | 'slower' {
    const ratio = abide / arm
    if (ratio < 1 + NOISE && ratio > 1 - NOISE) return 'same'
    return ratio <= 1 ? 'faster' : 'slower'
}

/**
 * abide ÷ arm, as a bare multiple: `4.55×`, and `0.22×` when abide is the faster one.
 *
 * It was a sentence — `abide 4.55× slower` — and a sentence is unreadable in a column of forty. The
 * direction the words were carrying is in the number itself once the axis is fixed: under one is
 * abide ahead, over one is behind, and the column head names which way the division went. `verdict`
 * still says which side of the noise floor it landed on, for a page that wants to colour it.
 *
 * Both zeroes are reachable and neither divides: an arm that did no work at all is the best result on
 * the page, and printing it as `NaN×` or `Infinity×` reads as the measurement having failed.
 */
export function ratioText(abide: number, arm: number): string {
    // Only the ZERO divisor needs the guard: any other equal pair divides to `1.00×` on its own.
    if (arm === 0) return abide === 0 ? '1.00×' : '∞×'
    return `${(abide / arm).toFixed(2)}×`
}

/**
 * The OTHER axis: what fraction of the whole op a SLICE of it took — `11.7% of the op`.
 *
 * A slice is not a rival, and `ratioText` cannot say so. `…of which the server` is a PART of the trip
 * the subject measures, so dividing the two produced `8.53×` in the column a reader scans for who
 * won — abide losing by 8.5× to a thing it contains. Same numbers, opposite reading.
 *
 * A share is also the number the project's own rule asks for before any of these layers is touched:
 * an optimisation is capped by the fraction of the op it touches, and this is that fraction, printed
 * on the row that motivates it. The suffix stays in the text because a bare `11.7%` under a head
 * reading `abide ÷ arm` is one more thing to work out — and it is `of abide` rather than `of the op`
 * because the column is 120px and a rounded `100.0% of the op` wants 122.
 *
 * One decimal, and a whole of zero has no share rather than a `NaN%` that reads as a failed run.
 */
export function shareText(part: number, whole: number): string {
    if (whole === 0) return '—'
    return `${((part / whole) * 100).toFixed(1)}% of abide`
}

// Yield long enough for the browser to paint what was just written.
//
// A hidden tab fires no `requestAnimationFrame` and clamps `setTimeout` to about a second, so a run
// left in a background tab would crawl for minutes — waiting to paint something nobody is looking
// at. Hidden, the yield is a `MessageChannel` task instead: it drains the event loop without being
// clamped, and there is no paint to wait for anyway.
const yielder = new MessageChannel()
const waiting: (() => void)[] = []
yielder.port1.onmessage = (): void => waiting.shift()?.()

export function frame(): Promise<void> {
    if (typeof requestAnimationFrame !== 'function' || document.visibilityState === 'hidden') {
        return new Promise((resolve) => {
            waiting.push(resolve)
            yielder.port2.postMessage(0)
        })
    }
    return new Promise((resolve) => {
        let done = false
        const finish = (): void => {
            if (done) return
            done = true
            resolve()
        }
        requestAnimationFrame(finish)
        setTimeout(finish, 32)
    })
}

/**
 * Let the engine go quiet between two measured batches.
 *
 * One `frame()` is not enough: a batch that allocated four million objects leaves a collection owed,
 * and whichever arm runs next pays it. So the wait is a few frames PLUS a fixed reference loop run
 * until it stops getting faster — the point at which the engine has finished whatever it was doing
 * and is timing the reference honestly again.
 */
export async function quiesce(): Promise<void> {
    for (let i = 0; i < 2; i++) await frame()

    const deadline = performance.now() + 300
    let best = Infinity
    let samples = 0
    for (;;) {
        const started = performance.now()
        let sum = 0
        for (let i = 0; i < 100_000; i++) sum += i % 7
        // The sum is CONSUMED, by a test that cannot pass: an engine that can prove the loop's result
        // unobserved can delete the loop, and the reference batch would then time nothing.
        if (sum < 0) throw new Error('unreachable')
        const elapsed = performance.now() - started
        // Two samples at minimum: the first has nothing to be within a fifth OF.
        if (samples > 0 && elapsed <= best * 1.2) return
        samples++
        best = Math.min(best, elapsed)
        if (performance.now() >= deadline) return
        await frame()
    }
}

/**
 * How many microtask TURNS a piece of work takes — the second of the three numbers this project
 * budgets emitted code in, and the one no timing can show.
 *
 * A self-rescheduling microtask counts every drain of the queue while the work is in flight. It
 * cannot starve the work: microtasks run FIFO, so the counter and the work interleave. What it
 * catches is the shape that looks fine on a clock and is ruinous at scale: an async generator hands
 * back a promise for a chunk it already has, so walking a thousand-row table through one costs about
 * seven thousand turns to produce a string it already has in a buffer.
 *
 * `floorTicks()` is what an empty async function costs, so a case can say what it OWES rather than
 * what it was charged.
 */
export async function microtasks(work: () => Promise<unknown>): Promise<number> {
    let turns = 0
    let counting = true
    const tick = (): void => {
        if (!counting) return
        turns++
        queueMicrotask(tick)
    }
    queueMicrotask(tick)
    await work()
    counting = false
    return turns
}

/** What `microtasks` reports for work that does nothing. Subtract it. */
export async function floorTicks(): Promise<number> {
    return await microtasks(async () => undefined)
}

let kept: unknown

/**
 * Consume a bench arm's result.
 *
 * A benchmark whose result is never used is a benchmark the optimiser is free to delete, so every
 * timed arm has to hand its answer somewhere the engine cannot prove dead. `keptValue` is that
 * proof: it reads the variable, so the store into it survives.
 */
export function keep(value: unknown): void {
    kept = value
}

/**
 * The other half of that proof, and DELIBERATELY uncalled.
 *
 * Nothing calls this and nothing should: it is exported so the engine cannot see that `kept` is
 * write-only and delete the store `keep` exists to make. A reader that has to run would defeat the
 * point — so the usual "who still calls this" question has no answer here, by design.
 */
export function keptValue(): unknown {
    return kept
}
