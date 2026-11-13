import { reactive } from '@abide/abide'
import { batch, type Batched } from '@abide/harness/report'

import { STAGES } from './STAGES.ts'

// The three panels as the card reads them, entries summed over `count` deals.
function panels(count: number): () => void {
    const entries = new Map<string, { count: number; value: number }>()
    for (const stage of STAGES) entries.set(stage, { count: 0, value: 0 })
    for (let at = 0; at < count; at += 1) {
        const entry = entries.get(STAGES[at % STAGES.length] as string)
        if (entry) {
            entry.count += 1
            entry.value += 1000
        }
    }
    const stages = [reactive('lead'), reactive('lead'), reactive('lead')]
    const readers = stages.map((stage) => reactive(() => entries.get(stage())))
    for (const reader of readers) reader()
    let at = 0
    return () => {
        at = (at + 1) % STAGES.length
        for (const stage of stages) stage.set(STAGES[at] as string)
        for (const reader of readers) reader()
    }
}

// The most a pick may take among 1,000 deals, in milliseconds.
export const CEILINGS = { priced: { 'among 1,000': 1 } }

/** Three panels onto the next stage, among 100 deals and among 1,000. */
export function priced(): Batched {
    return batch({
        case: 'put three panels on one stage, read each entry',
        emulated: null,
        arms: {
            'among 100': panels(100),
            'among 1,000': panels(1000),
        },
    })
}
