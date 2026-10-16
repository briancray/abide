// A CASE IS ARMED AND DISARMED, and `measure()` is those two around a body.

import { arm, blankWork, disarm } from './install.ts'
import { PUBLISHED_WORK_KEY, type PublishedWork } from './PUBLISHED_WORK.ts'
import type { Work } from './Work.ts'

/**
 * Every record published on the global, or null when nothing is.
 *
 * READ RATHER THAN IMPORTED. A prototype patch cannot see an effect rerun and this lane may not
 * import the subject to count one, so the subject puts fixed-shape records on the global and the
 * lane zeroes them when a case opens and copies them when it closes. Reading a global is not an
 * import edge, so the lane-isolation gate stays green.
 */
function sources(): PublishedWork | null {
    const record = (globalThis as Record<string, unknown>)[PUBLISHED_WORK_KEY]
    if (record === undefined || record === null) return null
    return record as PublishedWork
}

let openCase: Work | null = null

/**
 * Opens a case: starts counting DOM calls and zeroes every published counter.
 *
 * ONLY A FIELD THAT IS THERE AND IS A NUMBER IS ZEROED. Writing a field the source never declared
 * would create it at 0 and read it back at 0, and every gate asserting it would pass against a
 * counter nothing increments — so a missing field stays missing, and `publishedBy` names it.
 */
function armCase(): void {
    const record = blankWork()
    const published = sources()
    if (published)
        for (const source in published) {
            const counters = published[source] as Record<string, unknown>
            for (const field in counters)
                if (typeof counters[field] === 'number') counters[field] = 0
        }
    openCase = record
    arm(record)
}

/** Closes the open case and returns its `Work`, with every published source copied in. */
function disarmCase(): Work {
    const record = openCase
    if (!record) throw new Error('disarmCase() was called with no case armed.')
    disarm()
    openCase = null
    const published = sources()
    if (published) {
        const copied: PublishedWork = {}
        for (const source in published) {
            const counters = published[source] as Record<string, unknown>
            const numbers: Record<string, number> = {}
            for (const field in counters) {
                const value = counters[field]
                if (typeof value === 'number') numbers[field] = value
            }
            copied[source] = numbers
        }
        record.published = copied
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

/**
 * One source's counters off a `Work`, or null where that source published nothing (43.19).
 *
 * Throws naming each of `fields` the record lacks as a number (43.20): two halves of a wire that
 * cannot share a type agree on its shape here, at the read, or a misnamed field reads as a counter
 * that never moved.
 */
export function publishedBy<Field extends string>(
    work: Work,
    source: string,
    fields: readonly Field[],
): Record<Field, number> | null {
    const counters = work.published[source]
    if (counters === undefined) return null
    const missing: string[] = []
    for (const field of fields)
        if (typeof counters[field] !== 'number') missing.push(field)
    if (missing.length > 0)
        throw new Error(
            `${PUBLISHED_WORK_KEY}.${source} is published without a numeric ${missing.join(', ')}. A field the reader expects and the publisher does not declare would read as a counter that never moved.`,
        )
    return counters as Record<Field, number>
}
