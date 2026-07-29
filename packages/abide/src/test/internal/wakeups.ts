// COUNT WAKE-UPS. The framework's central contract is not what a reader returns, it is whether the
// reader RAN — "a probe wakes for its OWN axis", "a write that is observably identical wakes nobody",
// "an identity-equal re-fill wakes no value readers". A correctness test cannot hold any of those: the
// wrong implementation returns the right value, and only the WORK is different.
//
// That contract had no seam. It was asserted 196 times across 25 files as a hand-rolled closure
// counter plus a hand-rolled macrotask flush, and `const tick = () => new Promise(r => setTimeout(r,
// 0))` was redefined in six of them. The canonical case — a refresh over unchanged data wakes
// `refreshing` readers and not value readers — cost 30 lines of bookkeeping (two counters, two
// effects, two settled-baselines, two disposers) to assert a property the implementation states in
// about fifteen. A contract that expensive to assert is one that gets asserted where somebody
// remembered to, which is not the same as everywhere it holds.
//
// This is test-only support, under `internal/` so it is not part of the published surface.

import { effect } from '../../shared/internal/reactive.ts'

// Effect re-runs are microtask-batched; a macrotask tick guarantees they have flushed.
export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export interface Wakeups {
    // Re-runs since the last `settled(...)`. The effect's initial run is never counted — a subscription
    // costs one run to establish, and that is setup, not a wake-up.
    readonly count: number
    // Zero the counter without flushing. `settled` calls this; a test rarely needs it directly.
    reset(): void
    // Dispose the subscription. A test that leaves one open leaks an observer into the next case.
    stop(): void
}

// Subscribe to whatever `read` touches and count how many times the subscription re-runs.
//
// `read`'s RETURN is deliberately ignored: this measures the axis, not the value. Assert the value
// separately if you care about it — conflating them is what let a spinner flip over unchanged data
// read as "the value updated".
export function wakeups(read: () => unknown): Wakeups {
    let runs = 0
    let base = 0
    const stop = effect(() => {
        runs++
        read()
    })
    return {
        get count() {
            return runs - base
        },
        reset() {
            base = runs
        },
        stop,
    }
}

// Flush pending effect runs, then zero every probe — the "nothing has happened yet" baseline every
// wake-up assertion is relative to.
export async function settled(...probes: Wakeups[]): Promise<void> {
    await tick()
    for (const probe of probes) probe.reset()
}

// Dispose several probes at once, for a test that opened more than one.
export function stopAll(...probes: Wakeups[]): void {
    for (const probe of probes) probe.stop()
}
