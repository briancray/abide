// NOT A LANE. All three lanes need every name in here, in both
// substrates, and they ship into the browser injectable — so a lane is a DEPENDENCY
// partition and this depends on nothing, which makes it a leaf rather than a fourth
// question. Nothing here touches the filesystem: a `Bun.Glob` parked here would make the
// leaf bun-only, contradicting the one property it is justified by.

export { type Batched, type BatchSpec, batch } from './batch.ts'
export { emulatedDom } from './environment.ts'
export { claimOf, type Ratio, type RatioSpec, ratio } from './ratio.ts'
export type { Sample } from './Sample.ts'
export { THRESHOLDS } from './THRESHOLDS.ts'
