// THE BATCHER, and four of the five refusals.
//
// It never takes ONE arm. Interleaving A/B/A/B is not an option a caller remembers —
// JSC tiers LLInt -> Baseline -> DFG -> FTL, so whichever arm ran second inherits
// warmed code, which is a systematic bias and not noise — so the arms are supplied
// together and the interleave is the only thing this can do. The first arm is run a
// SECOND time, labelled as its own control, and whatever ratio that produces IS the
// floor for this case on this machine today. `underTheFloor` then means a number with
// a provenance rather than a word: "two runs, and if the arms swap places it is noise"
// is a sign test at n=2 and misses half of it by construction.

import { clockResolution, nanoseconds } from './clock.ts'
import type { Sample } from './Sample.ts'
import { substrate } from './substrate.ts'
import { THRESHOLDS } from './THRESHOLDS.ts'

// A timing sample must be at least this many times the clock's resolution, or it
// reports the clock rather than the code.
const MIN_CLOCK_MULTIPLE = 100

// Growth is multiplicative and capped: an op that cannot clear the bar at a hundred
// million reps is not an op this batcher can price, and looping forever hides that.
const GROWTH_FACTOR = 8

// How far above the bar a refined n aims. A sample sitting exactly on the bar fails
// the check it was chosen to pass as soon as the code warms up.
const BAR_MARGIN = 1.5
const MAX_N = 100_000_000

const DEFAULT_REPS = 7
const DEFAULT_WARMUP = 3

// A WALL-CLOCK CEILING ON THE WHOLE CALL. Growth is multiplicative against a bar set
// by the clock, and a browser's clock is 100 µs where bun's is 41 ns — so the same op
// that needs n=64 under bun needs n in the thousands in a page, and an op that cannot
// clear the bar at all grows until `MAX_N` while doing real DOM work. Measured: a
// 50-row class toggle in chromium, with no budget, did not finish in five minutes.
// An op this cannot price in the budget is one it says it cannot price.
const DEFAULT_BUDGET_NANOSECONDS = 2_000_000_000

// `Bun.gc(true)` is a synchronous full collection and it is on the global rather than
// behind an import, which is what lets this file ship into the browser injectable —
// `bun:jsc` is a specifier a browser bundler must resolve and nothing stands in for it.
// By the MEMBER, not the global: a docs example frame's `Bun.serve` shim has no `gc`,
// and `BUN?.gc(true)` on it is a TypeError in the middle of a timing run.
const BUN_GC = (globalThis as { Bun?: { gc?(sync: boolean): void } }).Bun?.gc

// `bun run test` is `--parallel`, and bun marks a worker process with this.
const WORKER_ID = (
    globalThis as { process?: { env: Record<string, string | undefined> } }
).process?.env?.BUN_TEST_WORKER_ID

export type Batched = {
    case: string
    n: number
    reps: number
    warmup: number
    substrate: ReturnType<typeof substrate>
    // |control ratio − 1|. The A/A spread, measured, and what `underTheFloor` is
    // compared against.
    floor: number
    samples: Record<string, Sample>
}

export type BatchSpec = {
    case: string
    // Arm name -> the op, run once per call. Two or more, and the first is also the
    // A/A control.
    arms: Record<string, () => void>
    // Set by the LANE. A duration whose op touched an emulated DOM is refused here
    // rather than at reporting time, so the number never exists to be quoted.
    emulated: 'dom' | null
    // What each arm DID, counted in a separate pass. Counting and timing are mutually
    // exclusive passes over the same body — the counter runs inside the path it counts
    // — so the work cannot come off this run and is handed in.
    work?: Readonly<Record<string, Readonly<Record<string, number>>>>
    // Fixed batch size, when a second `batch()` call has to match a first. Left out,
    // it grows until the sample clears the bar.
    n?: number
    reps?: number
    warmup?: number
    // Wall clock for the whole call. A page has a reader waiting on it.
    budgetNanoseconds?: number
}

function collectGarbage(): void {
    if (typeof BUN_GC === 'function') BUN_GC(true)
}

// One timed batch of `n` operations, in nanoseconds. Not per-op: the caller divides,
// after taking the minimum.
function timeBatch(body: () => void, n: number): number {
    const before = nanoseconds()
    for (let index = 0; index < n; index += 1) body()
    return nanoseconds() - before
}

function percentile95(sorted: number[]): number {
    const index = Math.ceil(sorted.length * 0.95) - 1
    return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] as number
}

export function batch(spec: BatchSpec): Batched {
    // Refusal 5. Eight workers competing for cores measures the scheduler, and with a
    // MEASURED floor the floor goes so wide under contention that every real
    // regression reads as `underTheFloor` — a gate that stops gating without failing.
    if (WORKER_ID !== undefined)
        throw new Error(
            `batch("${spec.case}") ran in parallel worker ${WORKER_ID}. Counts belong in \`bun test\`; anything with a clock runs under \`bun run test:serial\` or \`bun run bench\`.`,
        )
    // Refusal 4. Not "a bun sample with unit ms" — that refuses a build-time µs and a
    // TTFB, both DOM-free, and lets a `ns` through on a spelling.
    if (spec.emulated === 'dom')
        throw new Error(
            `batch("${spec.case}") was handed emulated: 'dom'. happy-dom can produce a count; it cannot produce a millisecond anybody should quote.`,
        )

    const names = Object.keys(spec.arms)
    if (names.length === 0)
        throw new Error(`batch("${spec.case}") was given no arms`)

    // The A/A control: the first arm again, under a name no caller can collide with.
    const control = `${names[0]} (A/A)`
    const lanes: { name: string; body: () => void }[] = []
    for (const name of names)
        lanes.push({ name, body: spec.arms[name] as () => void })
    lanes.push({
        name: control,
        body: spec.arms[names[0] as string] as () => void,
    })

    const resolution = clockResolution()
    // An unmeasurable clock makes the bar infinite, and an infinite bar turns the
    // growth loop into `MAX_N` operations of real work. Refused before it starts.
    if (!Number.isFinite(resolution))
        throw new Error(
            `batch("${spec.case}") could not measure this clock: no non-zero step in ${MIN_CLOCK_MULTIPLE * 200} probes. There is no sample size that makes a reading of it a reading of the code.`,
        )
    const bar = MIN_CLOCK_MULTIPLE * resolution
    const budget = spec.budgetNanoseconds ?? DEFAULT_BUDGET_NANOSECONDS
    const startedAt = nanoseconds()
    const reps = spec.reps ?? DEFAULT_REPS
    const warmup = spec.warmup ?? DEFAULT_WARMUP

    // GROW UNTIL THE SAMPLE CLEARS THE BAR, and the growth probe is the run itself.
    // A probe taken BEFORE the warm-up reps grows against cold code and then the
    // timed reps come in under the bar anyway — measured: an arm that needed n=512
    // cold reported 1208 ns warm, a third of the bar, and the batcher would have
    // thrown on a sample size it had chosen itself.
    // A CHEAP PROBE FINDS THE STARTING n, and the full run is what proves it. Growing
    // by re-running warm-up and every rep at each step costs the whole rep set once
    // per doubling — it is what made the browser case unfinishable — and growing off
    // a COLD probe alone undershoots, because the timed reps come back faster than
    // the probe that chose n. So: probe cheaply, run fully, and grow again if the run
    // misses the bar.
    let n = spec.n ?? 1
    if (spec.n === undefined) {
        while (n < MAX_N) {
            let fastestProbe = Number.POSITIVE_INFINITY
            for (const lane of lanes) {
                const took = timeBatch(lane.body, n)
                if (took < fastestProbe) fastestProbe = took
            }
            if (fastestProbe >= bar) {
                // REFINED DOWN, because growth is multiplicative and the step that
                // clears the bar overshoots it by up to the whole factor. Measured in
                // webkit, whose 1 ms clock puts the bar at 100 ms a batch: n jumped
                // 4,096 -> 32,768, each batch took ~480 ms instead of ~100, and the
                // run blew a 5 s budget it would otherwise have fitted in twice over.
                // The margin keeps the refined n clear of the bar rather than on it.
                n = Math.max(
                    1,
                    Math.ceil((n * bar * BAR_MARGIN) / fastestProbe),
                )
                break
            }
            if (nanoseconds() - startedAt > budget)
                throw new Error(
                    `batch("${spec.case}") spent its ${budget / 1e6} ms budget growing n and reached ${n} without clearing ${MIN_CLOCK_MULTIPLE}x the clock (${resolution} ns). This op is not priceable on this clock.`,
                )
            n = Math.min(n * GROWTH_FACTOR, MAX_N)
        }
    }
    let timings = new Map<string, number[]>()
    for (;;) {
        timings = new Map<string, number[]>()
        for (const lane of lanes) timings.set(lane.name, [])
        // A/B/A/B, never in blocks. Warm-up reps run through the same interleave and
        // are discarded, so no arm carries the other's tiering into the timed reps.
        for (let rep = 0; rep < warmup + reps; rep += 1) {
            for (const lane of lanes) {
                collectGarbage()
                const took = timeBatch(lane.body, n)
                if (rep >= warmup)
                    (timings.get(lane.name) as number[]).push(took)
            }
            // CHECKED PER REP, not only per growth step. One batch at the n a coarse
            // clock forces is not short: webkit clamps `performance.now()` to 1 ms,
            // so the bar is 100 ms a batch and n reached 32,768 — the run took 7.3 s
            // against a 2 s budget and reported nothing, because the only check was
            // between runs.
            if (nanoseconds() - startedAt > budget)
                throw new Error(
                    `batch("${spec.case}") spent its ${budget / 1e6} ms budget at n=${n} after ${rep + 1} of ${warmup + reps} reps. This clock (${resolution} ns) needs a bigger sample than the budget buys.`,
                )
        }
        let fastest = Number.POSITIVE_INFINITY
        for (const taken of timings.values())
            for (const took of taken) if (took < fastest) fastest = took
        if (fastest >= bar) break
        if (nanoseconds() - startedAt > budget)
            throw new Error(
                `batch("${spec.case}") spent its ${budget / 1e6} ms budget and the sample still reads ${fastest} ns at n=${n}, under ${MIN_CLOCK_MULTIPLE}x the clock (${resolution} ns).`,
            )
        // Refusal 3. A pinned n is the caller matching a previous run, so growing it
        // silently would break the equality `ratio()` checks. Throw instead.
        if (spec.n !== undefined || n >= MAX_N)
            throw new Error(
                `batch("${spec.case}") took ${fastest} ns at n=${n}, under ${MIN_CLOCK_MULTIPLE}x the clock's measured resolution (${clockResolution()} ns). The sample would be the clock, not the code.`,
            )
        n = Math.min(n * GROWTH_FACTOR, MAX_N)
    }

    const perOperation = new Map<string, { min: number; p95: number }>()
    for (const [name, taken] of timings) {
        const sorted = taken.slice().sort((one, two) => one - two)
        perOperation.set(name, {
            min: (sorted[0] as number) / n,
            p95: percentile95(sorted) / n,
        })
    }

    const where = substrate()
    const samples: Record<string, Sample> = {}
    for (const name of names) {
        const taken = perOperation.get(name) as { min: number; p95: number }
        samples[name] = {
            arm: name,
            case: spec.case,
            n,
            reps,
            warmup,
            substrate: where,
            emulated: spec.emulated,
            nanoseconds: taken.min,
            p95: taken.p95,
            // An op measured WHOLE and under a frame cannot be resolved by a wall
            // clock. A batched micro-op is under a frame by construction and the
            // frame is not its threshold.
            underOneFrame: n === 1 && taken.min < THRESHOLDS.frame,
            work: spec.work?.[name] ?? null,
        }
    }

    const first = perOperation.get(names[0] as string) as { min: number }
    const controlTiming = perOperation.get(control) as { min: number }
    return {
        case: spec.case,
        n,
        reps,
        warmup,
        substrate: where,
        floor: Math.abs(controlTiming.min / first.min - 1),
        samples,
    }
}
