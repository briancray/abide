// Shared adaptive timing loop for every abide bench (the CLI runners `run.ts`/`server.ts` and the
// docs-app live bench pages). One measurement methodology, imported by all, so numbers stay comparable
// across surfaces and release-over-release: a short warmup, then repeat the op until BOTH the time floor
// and the iteration floor are met; report mean ns/op.
//
// The floors default to the CLI budget (env-overridable) but are per-call overridable via `opts`, so a
// live docs page can run a shorter, page-load-friendly budget without a second copy of the loop.

export const DEFAULT_MIN_TIME_MS = Number(process.env.ABIDE_BENCH_TIME ?? 400)
export const DEFAULT_MIN_ITERS = Number(process.env.ABIDE_BENCH_MIN_ITERS ?? 25)
export const DEFAULT_WARMUP_ITERS = 5

export interface MetricResult {
    nsPerOp: number
    iters: number
}

export interface MeasureOptions {
    minTimeMs?: number
    minIters?: number
    warmupIters?: number
}

// Repeatedly invoke `op` until the time and iteration floors are both met; return mean ns/op.
export async function measure(
    op: () => Promise<void> | void,
    opts?: MeasureOptions,
): Promise<MetricResult> {
    const minTimeMs = opts?.minTimeMs ?? DEFAULT_MIN_TIME_MS
    const minIters = opts?.minIters ?? DEFAULT_MIN_ITERS
    const warmupIters = opts?.warmupIters ?? DEFAULT_WARMUP_ITERS
    for (let i = 0; i < warmupIters; i++) await op()
    let iters = 0
    const start = Bun.nanoseconds()
    let elapsed = 0
    const budgetNs = minTimeMs * 1e6
    do {
        await op()
        iters++
        elapsed = Bun.nanoseconds() - start
    } while (elapsed < budgetNs || iters < minIters)
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
