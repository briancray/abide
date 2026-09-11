// Lane 2 of 3, and entry 2 of 5 — WHAT BLINK DID: style, layout, paint, forced layout, and the
// per-layer durations `shares()` turns into the fraction of an op each layer took.
// Read over CDP, so chromium only, and driven from the playwright side — an engine
// number is not available inside a case body, and that is a property of the lane
// rather than a gap.
//
// `harness/report` is a FOURTH entry and is not a fourth lane: a lane is a DEPENDENCY
// partition, and the leaf depends on nothing. See docs/DECISIONS.md D101.

export { type Shares, type SharesSpec, shares } from './shares.ts'
export type { Trace } from './Trace.ts'
export { traceOp } from './traceOp.ts'
