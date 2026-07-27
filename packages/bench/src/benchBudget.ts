// The stop rule every abide bench shares — the CLI runners (`run.ts`/`server.ts`) and the docs app's
// live bench pages alike. It lives on its own, free of `Bun` and of a bare `process`, because the docs
// pages import it INTO THE BROWSER: a second copy of this policy is how the two surfaces drift, and
// they must not, or their numbers stop being comparable.
//
// Clocked with `performance.now()` rather than `Bun.nanoseconds()` for the same reason — it exists on
// both sides. The precision gap does not matter here: this is a WALL ceiling measured in hundreds of
// milliseconds, not a sample.

// `process` is absent in a browser bundle, so read it defensively rather than at the top level.
function fromEnv(name: string, fallback: number): number {
    const raw = typeof process === 'undefined' ? undefined : process.env?.[name]
    const value = Number(raw ?? fallback)
    return Number.isFinite(value) ? value : fallback
}

export const DEFAULT_MIN_TIME_MS = fromEnv('ABIDE_BENCH_TIME', 400)
export const DEFAULT_MIN_ITERS = fromEnv('ABIDE_BENCH_MIN_ITERS', 25)
export const DEFAULT_WARMUP_ITERS = 5
// The WALL ceiling per metric — how long a measurement may take, as opposed to how many nanoseconds of
// samples it collects. The two differ whenever a round has untimed setup around the timed region
// (`run.ts`'s mount/unmount/update loops rebuild a host per round, and so do the docs bench pages), and
// they differ ENORMOUSLY when the timed region is cheap and the setup is not: collecting 400ms of 74ns
// updates means 5.4M rounds, each paying a full 1000-row mount. Measured before this ceiling existed,
// `list-swap-1000` spent 13.2s of wall for 2.4s of samples — its vanilla `unmount` alone did 3,939
// untimed mounts to time 3,939 teardowns. The browser page showed the same shape from the same cause:
// its unmount pass ran 4.7× its mount pass and took 20.5s of a 35.5s run. The extra samples buy
// nothing: a mean over a few hundred repetitions of the same deterministic op is already converged. So
// the loop stops at whichever comes first, and `minIters` remains the floor that no ceiling may cut into.
export const DEFAULT_MAX_WALL_MS = fromEnv('ABIDE_BENCH_MAX_WALL', DEFAULT_MIN_TIME_MS)

export interface BenchBudgetOptions {
    minTimeMs?: number
    minIters?: number
    warmupIters?: number
    maxWallMs?: number
}

// Construct it when measurement starts, then ask `more(timedNs, iters)` after each round.
export function benchBudget(opts?: BenchBudgetOptions): {
    more(timedNs: number, iters: number): boolean
} {
    const minTimeNs = (opts?.minTimeMs ?? DEFAULT_MIN_TIME_MS) * 1e6
    const minIters = opts?.minIters ?? DEFAULT_MIN_ITERS
    const maxWallMs = opts?.maxWallMs ?? DEFAULT_MAX_WALL_MS
    const startedAt = performance.now()
    return {
        more(timedNs: number, iters: number): boolean {
            if (iters < minIters) return true // the statistical floor outranks the wall ceiling
            if (timedNs >= minTimeNs) return false
            return performance.now() - startedAt < maxWallMs
        },
    }
}
