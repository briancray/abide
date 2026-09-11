// Entry 4 of 5, and NOT A LANE. All three lanes need every name in here, in both
// substrates, and they ship into the browser injectable — so a lane is a DEPENDENCY
// partition and this depends on nothing, which makes it a leaf rather than a fourth
// question. See docs/DECISIONS.md D101.
//
// What is NOT here: the LOC counter and the `example.json` writer. Both run once, on
// bun, from a script, and both touch the filesystem — a `Bun.Glob` parked here would
// make the leaf bun-only, contradicting the one property it is justified by, and an
// import edge is priced by the module it lands on, so `measure` reaching for a clock
// would drag a glob into the module the injectable is built from. They live in
// `bun run bench`.

export { type Batched, type BatchSpec, batch } from './batch.ts'
export { clockResolution, nanoseconds } from './clock.ts'
export { type Ratio, type RatioSpec, ratio } from './ratio.ts'
export type { Sample } from './Sample.ts'
export { substrate } from './substrate.ts'
export { THRESHOLDS } from './THRESHOLDS.ts'
