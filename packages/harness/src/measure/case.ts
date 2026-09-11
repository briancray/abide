// A CASE IS ARMED AND DISARMED, and `measure()` is those two around a body. They are
// apart from the barrel so `profile.ts` can reach them without importing the module
// that re-exports it — a cycle that resolved fine and would have broken on the first
// reordering.

import { arm, blankWork, disarm } from './install.ts'
import {
    PUBLISHED_WORK_FIELDS,
    PUBLISHED_WORK_KEY,
    type PublishedWork,
} from './PUBLISHED_WORK.ts'
import type { Work } from './Work.ts'

// WHAT ABIDE PUBLISHES, read rather than imported. A prototype patch cannot see an
// effect re-run and this lane may not import abide to count one, so the framework
// puts a fixed-shape record on the global under a dev flag and the harness reads it
// and zeroes it. Reading a global is not an import edge, so the lane-isolation gate
// stays green — reverted to an import of `graph.ts`, it fails, which is what it is
// for.
//
// `propagated` is module-local and not among `graph.ts`'s exports, so a descent has
// no object to patch and no body a test can write. That is the one of the three this
// mechanism is bought for; the other two an effect body could have counted itself.
//
// TWO WAYS FOR A WIRE PROTOCOL TO GO QUIET, and the type system catches neither —
// abide and this lane cannot share a declaration, so the shape is agreed by two
// documents rather than by one type. ABSENT is answered by leaving the three rows
// `null` (44.23) rather than by throwing, which would take every DOM-only case and the
// whole hand-written arm with it. INCOMPLETE — a record published with a field
// misnamed, or not yet added — is answered by a throw naming the field (44.24).
//
// And it is `armCase()` that makes the incomplete case the worse of the two, which is
// not what it looks like: the zeroing pass below WRITES all three fields onto whatever
// was published, so a field abide never declared is created here at 0 and read back at
// 0. Measured with the check out — a record carrying only `wakes` and `bindingRuns`
// reports `descents: 0`, not `undefined`, and `REACTIVE.md`'s k=8 gate of 16 against 256
// passes on it. See D113.
function published(): PublishedWork | null {
    const record = (globalThis as Record<string, unknown>)[PUBLISHED_WORK_KEY]
    if (record === undefined || record === null) return null
    const missing: string[] = []
    for (const field of PUBLISHED_WORK_FIELDS)
        if (typeof (record as Record<string, unknown>)[field] !== 'number')
            missing.push(field)
    if (missing.length > 0)
        throw new Error(
            `${PUBLISHED_WORK_KEY} is published without a numeric ${missing.join(', ')}. A field this lane reads and the publisher does not declare is created at 0 by the zeroing pass and read back at 0, so every gate asserting it passes against a counter nothing increments.`,
        )
    return record as PublishedWork
}

let openCase: Work | null = null

// A CASE WITH NO BODY, for the one op whose body is the page itself. The arm a docs
// frame runs is not a function anybody can call — it is a script tag, and it keeps
// working after load while a fixture's latency runs out — so the load is counted by
// arming at document-start and reading whenever somebody asks, rather than by
// detecting that it has settled. `measure()` is these two around a body.
export function armCase(): void {
    const record = blankWork()
    const reactive = published()
    if (reactive) {
        reactive.wakes = 0
        reactive.bindingRuns = 0
        reactive.descents = 0
    }
    openCase = record
    arm(record)
}

export function disarmCase(): Work {
    const record = openCase
    if (!record) throw new Error('disarmCase() was called with no case armed.')
    disarm()
    openCase = null
    const reactive = published()
    if (reactive) {
        record.wakes = reactive.wakes
        record.bindingRuns = reactive.bindingRuns
        record.descents = reactive.descents
    }
    return record
}

export function measure(body: () => void): Work {
    armCase()
    try {
        body()
    } catch (error) {
        // The case is closed before the throw leaves, or the next `measure()` reports
        // that one is already armed and the real failure is two frames down.
        disarmCase()
        throw error
    }
    return disarmCase()
}
