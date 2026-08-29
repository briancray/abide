// Lane 1 of 3 — DOM CALL COUNTS, taken from inside the page.
// The only lane that runs in BOTH substrates (bun's DOM and a real browser), which
// is what lets a hand-written arm and an abide arm share one clock and one batch
// size. This lane has no abide in its import graph, and that constraint is the whole
// reason harness is a package rather than a folder (CLAUDE.md, "seams and imports").
//
// Holds: the mutation counters (nodes moved, nodes created, listeners bound), the
// batching that keeps a sample at least 100x the clock's resolution, and the ratio
// reporting a claim is made in.

export {}
