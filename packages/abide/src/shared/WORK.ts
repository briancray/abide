// THE THREE COUNTERS THE MEASUREMENT LANE READS, and the record they are published on. A leaf —
// no imports of its own — because both seams increment it and `harness/measure` reads it off
// `globalThis` rather than importing it: that lane may have no abide in its graph at all (44.1),
// so the two halves cannot share a declaration and the key is spelled on both sides.
//
// WHY ALL THREE OR NONE. `armCase()` zeroes every field it reads, so a field abide declares and
// never increments is created at 0 and read back at 0 — and every gate asserting it passes
// against a counter that was never wired (44.24). Publishing two of three is worse than
// publishing none, because the third looks measured.
//
// WHAT IT COSTS, measured rather than assumed: one integer increment on the propagation walk and
// one per effect run, priced on `bun run bench:reactive` against the run before it landed. The
// numbers are in the commit that added this.
export const WORK = {
    // Effect body runs. A reader that woke when nothing it reads changed still reads the right
    // value, which is why this is asserted and the value is not.
    wakes: 0,
    // Compiled reactive slots that ran — incremented by the client runtime, not by the core.
    bindingRuns: 0,
    // Nodes visited by one propagation walk.
    descents: 0,
}

// The name is spelled here and again in `harness/measure`'s own leaf. Two copies on purpose: the
// lane checks the SHAPE at the read rather than sharing a type, so a rename breaks a test rather
// than silently publishing to a key nothing looks at.
;(globalThis as unknown as Record<string, unknown>).__ABIDE_WORK__ = WORK
