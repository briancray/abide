// A CASE IS ARMED AND DISARMED, and `measure()` is those two around a body.

import { arm, blankWork, disarm } from './install.ts'
import {
    PUBLISHED_WORK_FIELDS,
    PUBLISHED_WORK_KEY,
    type PublishedWork,
} from './PUBLISHED_WORK.ts'
import type { Work } from './Work.ts'

/**
 * The work record abide published on the global, or null when there is none.
 *
 * Throws when the record lacks a numeric field this lane reads (44.21).
 *
 * WHAT ABIDE PUBLISHES, read rather than imported. A prototype patch cannot see an effect re-run
 * and this lane may not import abide to count one, so the framework puts a fixed-shape record on
 * the global under a dev flag and the harness reads it and zeroes it. Reading a global is not an
 * import edge, so the lane-isolation gate stays green — reverted to an import of abide's
 * `Reactive.ts`, it fails, which is what it is for.
 *
 * `markReaders` is module-local and not among `Reactive.ts`'s exports, so a descent has no object
 * to patch and no body a test can write. That is the one of the three this mechanism is bought
 * for; the other two an effect body could have counted itself.
 *
 * TWO WAYS FOR A WIRE PROTOCOL TO GO QUIET, and the type system catches neither — abide and this
 * lane cannot share a declaration, so the shape is agreed by two documents rather than by one
 * type. ABSENT is answered by leaving the three rows `null` (44.20) rather than by throwing, which
 * would take every DOM-only case and the whole hand-written arm with it. INCOMPLETE — a record
 * published with a field misnamed, or not yet added — is answered by a throw naming the field
 * (44.21).
 *
 * And it is `armCase()` that makes the incomplete case the worse of the two, which is not what it
 * looks like: the zeroing pass below WRITES all three fields onto whatever was published, so a
 * field abide never declared is created here at 0 and read back at 0. Measured with the check out
 * — a record carrying only `wakes` and `bindingRuns` reports `descents: 0`, not `undefined`, and
 * the reactive core's k=8 gate of 16 against 256 passes on it.
 */
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

/** Opens a case: starts counting DOM calls and zeroes abide's published record. */
function armCase(): void {
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

/** Closes the open case and returns its `Work`, with abide's published counts read in. */
function disarmCase(): Work {
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

/** Runs `body` inside an armed case and returns the `Work` it did. */
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
