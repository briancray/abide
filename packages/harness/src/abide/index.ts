// THE BUILT-IN ADAPTER FOR AN ABIDE APP, and the one entry of this package allowed to know abide.
// Every lane measures anything; this is what makes the general instrument read like abide's own:
// `measure` with abide's three counters on the record by name, and abide's `mount` beside it, so an
// app's test imports both from one place.
//
// ABIDE IS NOT IMPORTED TO COUNT. abide publishes its counters on the global every lane reads
// (`WORK.ts`, 43.21) and this reads them back by name, so the counting stays in the lane and the
// adapter only names the fields.

import {
    measure as measureWork,
    publishedBy,
    type Work,
} from '../measure/index.ts'

export { type Mounted, mount } from '@abide/abide/test'

const FIELDS = ['wakes', 'bindingRuns', 'descents'] as const

/**
 * What an op did: the DOM rows the harness counts, and abide's own three.
 *
 * Each of the three is `null` where no abide runtime has loaded in the process — absent, never 0
 * (43.19).
 */
export type AbideWork = Work & {
    /** Effect runs. */
    wakes: number | null
    /** Compiled reactive slots that ran. */
    bindingRuns: number | null
    /** Nodes visited by propagation walks. */
    descents: number | null
}

/**
 * Runs `body` inside an armed case and returns the work it did, abide's counters included.
 *
 * Throws where abide's record is published without one of its fields as a number (43.20).
 */
export function measure(body: () => void): AbideWork {
    const work = measureWork(body)
    const counted = publishedBy(work, 'abide', FIELDS) ?? {
        wakes: null,
        bindingRuns: null,
        descents: null,
    }
    return {
        ...work,
        wakes: counted.wakes,
        bindingRuns: counted.bindingRuns,
        descents: counted.descents,
    }
}
