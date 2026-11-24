// THE RUNTIME'S WORK COUNTERS AS AN EXAMPLE READS THEM: the record abide publishes on
// `globalThis.__HARNESS_WORK__` for the measurement harness (43.21), read the same way the harness
// reads it — off the global by its field names, never by importing the runtime's own module.

/** What the runtime did: compiled bindings that ran, effect bodies that woke, values one walk visited. */
export type Work = { bindingRuns: number; wakes: number; descents: number }

type HarnessGlobal = {
    __HARNESS_WORK__?: Record<string, Partial<Work>>
}

/** The counters this moment, or zeros where the runtime has published none. */
export function workNow(): Work {
    const counters = (globalThis as HarnessGlobal).__HARNESS_WORK__?.abide
    return {
        bindingRuns: counters?.bindingRuns ?? 0,
        wakes: counters?.wakes ?? 0,
        descents: counters?.descents ?? 0,
    }
}

/** What the counters moved since `before`. */
export function workSince(before: Work): Work {
    const now = workNow()
    return {
        bindingRuns: now.bindingRuns - before.bindingRuns,
        wakes: now.wakes - before.wakes,
        descents: now.descents - before.descents,
    }
}
