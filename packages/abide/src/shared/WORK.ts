/**
 * The three work counters the measurement lane reads, and the record they are published on.
 *
 * A leaf — no imports of its own — because both seams increment it and `@abide/harness/measure`
 * reads it off `globalThis` rather than importing it: that lane may have nothing under test in its
 * graph at all (43.1), so the two halves cannot share a declaration and the key is spelled on both
 * sides. `@abide/harness/abide`'s `measure` reads it back by these field names, and throws naming
 * one the record lacks (43.20).
 *
 * WHAT IT COSTS is one integer increment on the propagation walk and one per effect run, and it
 * is UNDER THE NOISE FLOOR rather than priced: two runs of `bun run bench:reactive` put the
 * largest consistent signal at +3.0% then +4.9% on fan-out-to-1000, against +0.0% then +7.1% on
 * `read a settled value`, which has no counter anywhere near it. The floor is wider than every
 * signal, so this is a trade taken deliberately and NOT a number — read it that way before
 * widening the set.
 */
export const WORK = {
    /**
     * Effect body runs.
     *
     * A reader that woke when nothing it reads changed still reads the right value, which is why
     * this is asserted and the value is not.
     */
    wakes: 0,
    /** Compiled reactive slots that ran — incremented by the client runtime, not by the core. */
    bindingRuns: 0,
    /** Nodes visited by one propagation walk. */
    descents: 0,
}

// The key is spelled here and again in the harness's own leaf. Two copies on purpose: the lane
// checks the SHAPE at the read rather than sharing a type, so a rename breaks a test rather than
// silently publishing to a key nothing looks at.
type HarnessGlobal = {
    __HARNESS_WORK__?: Record<string, Record<string, number>>
}
const published = (globalThis as HarnessGlobal).__HARNESS_WORK__ ?? {}
published.abide = WORK
;(globalThis as HarnessGlobal).__HARNESS_WORK__ = published
