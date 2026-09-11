// Lane 1 of 3, and entry 1 of 5 — DOM CALL COUNTS, taken from inside the page.
// The only lane that runs in BOTH substrates (bun's DOM and a real browser), which
// is what lets a hand-written arm and an abide arm share one clock and one batch
// size. This lane has no abide in its import graph, and that constraint is the whole
// reason harness is a package rather than a folder (CLAUDE.md, "seams and imports").
//
// `harness/report` is a FOURTH entry and is not a fourth lane: a lane is a DEPENDENCY
// partition, and the leaf depends on nothing. See docs/DECISIONS.md D101.

import { type Batched, type BatchSpec, batch } from '../report/index.ts'
import { install, isArmed } from './install.ts'

export { armCase, disarmCase, measure } from './case.ts'
export { install, patchSet } from './install.ts'
export {
    PUBLISHED_WORK_FIELDS,
    PUBLISHED_WORK_KEY,
    type PublishedWork,
} from './PUBLISHED_WORK.ts'
export { profile, watchLongTasks } from './profile.ts'
export type { ArmReading, Reading } from './Reading.ts'
export type { Work } from './Work.ts'

// THE INTERLOCK, and it replaces a measurement rather than deferring one. The
// counter's own overhead was going to be the first number taken here; it is
// irrelevant to a count and fatal to a duration, and taking it under happy-dom
// guarantees the wrong answer — measured, interleaved, min-of-7, the PATCHED arm came
// out FASTER at 0.89x, because `appendChild` there is ~130 ns of JavaScript and a JS
// wrapper is a rounding error on it, where in Chromium the same member is native and
// a patch both adds a frame and deoptimises the call site. So there is no threshold
// to hold the lane to: there is no duration field, and this throws while the counters
// are armed.
export function time(spec: Omit<BatchSpec, 'emulated'>): Batched {
    if (isArmed())
        throw new Error(
            'time() was called while the counters are armed. Counting and timing are mutually exclusive passes over the same case body — the counter runs inside the path it counts.',
        )
    // By the member — an example frame's `Bun.serve` shim is not bun.
    const underBun =
        typeof (globalThis as { Bun?: { nanoseconds?: unknown } }).Bun
            ?.nanoseconds === 'function'
    return batch({
        ...spec,
        emulated: underBun && typeof document !== 'undefined' ? 'dom' : null,
    })
}

// Installed at import in the browser injectable. Under bun the preload does it, next
// to `GlobalRegistrator.register`.
if (
    typeof document !== 'undefined' &&
    (globalThis as { Bun?: unknown }).Bun === undefined
)
    install()
