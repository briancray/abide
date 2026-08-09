// The measurement half of a bench: how an arm is timed, and what a ratio is allowed to claim.
//
// Nothing here renders. The example package draws the cards; what lives here is the part a claim
// depends on being right — the batch sizing, the best-of-many estimate, and the noise threshold
// under which two arms are simply the same.
//
// Arms are timed INTERLEAVED, one pass over all of them at a time, and that is the load-bearing
// decision. Run to completion in turn, an arm inherits whatever the previous one left behind: the
// same hand-written emitter measured 38.6 ns alone and 8.84 µs after abide's arm had run, which
// turned "abide 2.21x slower" into "abide 121x faster" on the page. Interleaving spreads that drift
// across every arm instead of loading it onto whichever ran second, and the per-arm minimum then
// finds a pass where the tab was quiet. `spread` is what says whether such a pass ever happened.

import { isThenable } from '$shared/internal/probes.ts'

export interface Arm {
    label: string
    /** Run once. `i` increases monotonically so an arm can alternate values and defeat caching. */
    run: (i: number) => unknown
    /** Run once before timing starts, outside the measured region. */
    prepare?: () => void
}

export interface Timing {
    nsPerOp: number
    ops: number
    /**
     * Median ÷ best across the passes. 1 is a perfectly quiet run; a large number means most passes
     * were polluted and only the minimum is worth reading — which is a fact about the RUN, not about
     * the code, and the page says so rather than quietly reporting the minimum as though it were
     * representative.
     */
    spread: number
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
 * Nine rather than five, and the difference is reproducibility rather than precision. `spread` says
 * whether the passes within ONE run agreed; it cannot say whether the run agrees with the next one,
 * and a card that reads 2.84× and then 4.77× with nothing changed supports no claim in either
 * direction. At five passes that card swung 68% between runs; at nine it swings 4%. The minimum
 * needs enough attempts to find a window where nothing else on the page interrupted it, and an arm
 * that awaits per op — thirty thousand microtasks in a batch — needs more of them than most.
 */
const PASSES = 9

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

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b)
    const middle = sorted.length >> 1
    if (sorted.length % 2 === 1) return sorted[middle] as number
    return (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2) as number
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

    return state.map((entry) => {
        const best = Math.min(...entry.samples)
        return {
            nsPerOp: best * 1e6,
            ops: entry.batch * PASSES,
            spread: best === 0 ? 1 : median(entry.samples) / best,
        }
    })
}

interface Measured {
    batch: number
    /** Milliseconds per op, one entry per pass. */
    samples: number[]
}

/** Calibrate every arm, then time them interleaved for `passes` passes. */
async function measureArms(arms: Arm[], settle: () => Promise<void>, passes: number): Promise<Measured[]> {
    const state = arms.map((arm) => ({ arm, batch: 1, offset: 3, samples: [] as number[] }))

    for (const entry of state) {
        entry.arm.prepare?.()
        await runBatch(entry.arm, 3, 0) // warm the JIT and any first-call caches
        const calibrated = await calibrate(entry.arm, entry.offset)
        entry.batch = calibrated.batch
        entry.offset = calibrated.offset
        await settle()
    }

    for (let pass = 0; pass < passes; pass++) {
        for (const entry of state) {
            const elapsed = await runBatch(entry.arm, entry.batch, entry.offset)
            entry.offset += entry.batch
            entry.samples.push(elapsed / entry.batch)
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
 * Three passes rather than nine: a `run` asserts a bound loose enough to survive a noisy pass, where
 * a card prints the number itself.
 */
export async function nsPerOp(arms: Arm[], settle: () => Promise<void> = frame): Promise<number[]> {
    const state = await measureArms(arms, settle, 3)
    return state.map((entry) => Math.min(...entry.samples) * 1e6)
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

// Always phrased from abide's side, and says so: a bare "1.23× slower" reads as a claim about the
// hand-written arm rather than about abide.
export function ratioText(abide: number, arm: number): string {
    const ratio = abide / arm
    const which = verdict(abide, arm)
    if (which === 'same') return 'abide — same, within noise'
    if (which === 'faster') return `abide ${(1 / ratio).toFixed(2)}× faster`
    return `abide ${ratio.toFixed(2)}× slower`
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
