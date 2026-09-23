// 44.1 — FIVE ENTRIES, THREE LANES. The package's whole public surface, in the order the lanes are
// read in: `measure` counts DOM calls from inside the page, `engine` is what Blink did, `server` is
// bytes and turns on bun, and the two that are not lanes are `report` (the Sample, the clock, the
// batcher, `ratio()`) and `gate` (the bun-side test vocabulary).
//
// A constants leaf, with no imports of its own: what counts the exported names and what serves the
// dashboard are two files, and two copies of this list is one list that goes stale.
export const HARNESS_ENTRIES: readonly string[] = [
    'harness/measure',
    'harness/engine',
    'harness/server',
    'harness/report',
    'harness/gate',
]
