// THE CLOCK, and the one number that says how much of it to believe.
//
// The two substrates are nowhere near each other and neither is introspectable, so the
// resolution is MEASURED once per process rather than assumed: `performance.now()`'s
// minimum non-zero delta is 41 ns under bun here, where the browser figure quoted
// everywhere is 100 µs — assuming the browser number over-batches by ~2400x, and a
// cross-origin-isolated page at 5 µs is a 20x error the other way.

// PROBED AGAINST A DEADLINE, NOT A COUNT, and the count is what got this wrong. A
// fixed 20,000 pairs sees a step on bun (41 ns) and on chromium (100 µs) and sees
// NOTHING in webkit, which clamps `performance.now()` harder — 20,000 pairs is about
// a millisecond of wall time, so a 1 ms clock may not tick once inside the probe. A
// probe that returns "unmeasurable" for Safari would take the whole timing half of a
// live panel off the table in one of the three engines a reader might bring.
//
// So it runs until it has seen a step, and then keeps going briefly to find the
// smallest one. 8 ms is under a frame and is paid once per process.
const PROBE_DEADLINE_MILLISECONDS = 8
const PROBES_AFTER_FIRST_STEP = 2_000

// `Bun.nanoseconds()` is the bun-side clock and it is already integer nanoseconds.
// `performance.now()` is milliseconds and is what a browser has.
//
// PROBED BY THE MEMBER, NOT BY THE GLOBAL. A docs example frame defines a `Bun.serve`
// shim so a hand-written arm's `server.ts` can run in the page, so `globalThis.Bun`
// is truthy in a browser that has no `nanoseconds` — and this called it. The same
// mistake is in three places and all three are now member probes.
const BUN = (globalThis as { Bun?: { nanoseconds?(): number } }).Bun
const BUN_CLOCK = typeof BUN?.nanoseconds === 'function' ? BUN : null

export function nanoseconds(): number {
    return BUN_CLOCK
        ? (BUN_CLOCK.nanoseconds as () => number)()
        : performance.now() * 1e6
}

let measured = 0

// The smallest non-zero step the clock can report, in nanoseconds. Cached: it is a
// property of the substrate, and the process does not change substrate.
export function clockResolution(): number {
    if (measured > 0) return measured
    const deadline = Date.now() + PROBE_DEADLINE_MILLISECONDS
    let smallest = Number.POSITIVE_INFINITY
    let sinceFirstStep = 0
    for (;;) {
        const before = nanoseconds()
        const after = nanoseconds()
        const step = after - before
        if (step > 0 && step < smallest) smallest = step
        if (Number.isFinite(smallest)) {
            sinceFirstStep += 1
            if (sinceFirstStep >= PROBES_AFTER_FIRST_STEP) break
        } else if (Date.now() >= deadline) break
    }
    // A clock that never stepped inside the deadline is coarser than a wall clock can
    // see, and reporting 0 would let the batcher accept any sample at all.
    measured = smallest
    return measured
}
