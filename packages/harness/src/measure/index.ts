// Lane 1 of 3 — DOM CALL COUNTS, taken from inside the page.
// The only lane that runs in BOTH substrates (bun's DOM and a real browser), which
// is what lets a hand-written arm and the arm under test share one clock and one
// batch size. This lane has nothing under test in its import graph, and that is
// the whole reason the harness is a package of its own.
//
// `harness/report` is a FOURTH entry and is not a fourth lane: a lane is a DEPENDENCY
// partition, and the leaf depends on nothing.

import { batch, type Batched, type BatchSpec } from '../report/batch.ts'
import { emulatedDom, underBun } from '../report/environment.ts'
import { install, isArmed } from './install.ts'

export { patchSet } from './install.ts'
export { measure, publishedBy } from './measure.ts'
export { PUBLISHED_WORK_KEY, type PublishedWork } from './PUBLISHED_WORK.ts'
export type { Work } from './Work.ts'

/**
 * `batch()` with the lane's `emulated` flag filled in. Throws while the counters are armed.
 *
 * THE INTERLOCK, and it replaces a measurement rather than deferring one. The counter's own
 * overhead was going to be the first number taken here; it is irrelevant to a count and fatal to
 * a duration, and taking it under happy-dom guarantees the wrong answer — measured, interleaved,
 * min-of-7, the PATCHED arm came out FASTER at 0.89x, because `appendChild` there is ~130 ns of
 * JavaScript and a JS wrapper is a rounding error on it, where in Chromium the same member is
 * native and a patch both adds a frame and deoptimizes the call site. So there is no threshold to
 * hold the lane to: there is no duration field, and this throws while the counters are armed.
 */
export function time(spec: Omit<BatchSpec, 'emulated'>): Batched {
    if (isArmed())
        throw new Error(
            'time() was called while the counters are armed. Counting and timing are mutually exclusive passes over the same case body — the counter runs inside the path it counts.',
        )
    return batch({ ...spec, emulated: emulatedDom() })
}

// Installed at import in a browser. Under bun the preload does it, next to
// `GlobalRegistrator.register`.
if (typeof document !== 'undefined' && !underBun()) install()
