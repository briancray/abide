// Shared adaptive timing loop for every abide bench (the CLI runners `run.ts`/`server.ts` and the
// docs-app live bench pages). One measurement methodology, imported by all, so numbers stay comparable
// across surfaces and release-over-release: a short warmup, then repeat the op until BOTH the time floor
// and the iteration floor are met (or the wall ceiling is reached); report mean ns/op.
//
// The stop rule itself lives in `benchBudget.ts` — free of `Bun` and of a bare `process`, so the docs
// bench pages can import the SAME policy into the browser instead of keeping a copy of it in step by
// hand. The floors default to the CLI budget (env-overridable) but are per-call overridable via `opts`,
// so a live docs page can run a shorter, page-load-friendly budget without a second copy of the loop.

export {
    benchBudget,
    DEFAULT_MAX_WALL_MS,
    DEFAULT_MIN_ITERS,
    DEFAULT_MIN_TIME_MS,
    DEFAULT_WARMUP_ITERS,
} from './benchBudget.ts'

import type { BenchBudgetOptions } from './benchBudget.ts'
import { benchBudget, DEFAULT_WARMUP_ITERS } from './benchBudget.ts'

export type MeasureOptions = BenchBudgetOptions

export interface MetricResult {
    nsPerOp: number
    iters: number
}

// Repeatedly invoke `op` until the time and iteration floors are met (or the wall ceiling is reached);
// return mean ns/op. Here the timed region IS the whole round, so the ceiling never binds first.
export async function measure(
    op: () => Promise<void> | void,
    opts?: MeasureOptions,
): Promise<MetricResult> {
    const warmupIters = opts?.warmupIters ?? DEFAULT_WARMUP_ITERS
    for (let i = 0; i < warmupIters; i++) await op()
    const budget = benchBudget(opts)
    let iters = 0
    const start = Bun.nanoseconds()
    let elapsed = 0
    do {
        await op()
        iters++
        elapsed = Bun.nanoseconds() - start
    } while (budget.more(elapsed, iters))
    return { nsPerOp: elapsed / iters, iters }
}

// The harness's own per-iteration cost: an empty op through the same loop (the `await` alone costs a
// microtask turn). It is ADDITIVE on both sides of a vanilla comparison, so any bench within a few
// multiples of it is floor-bound — its ratio is squashed toward 1.00× and understates the real one.
// Runners measure this once and mark the affected rows rather than silently reporting a flattering
// number. `NEAR_FLOOR_FACTOR` is the "too close to trust" line.
export const NEAR_FLOOR_FACTOR = 3

export function measureFloor(opts?: MeasureOptions): Promise<MetricResult> {
    return measure(() => {}, opts)
}

export function fmtNs(metric: MetricResult | null): string {
    if (metric === null) return '        —'
    const ns = metric.nsPerOp
    if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`.padStart(9)
    if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`.padStart(9)
    return `${ns.toFixed(0)} ns`.padStart(9)
}
