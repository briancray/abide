import { batch, type Batched } from '@abide/harness/report'

import { pipeline } from './pipeline.ts'

// The most an advance may take among 1,000 deals, in milliseconds.
export const CEILINGS = { priced: { 'among 1,000': 1 } }

/** Advancing one deal among 100, and among 1,000. */
export function priced(): Batched {
    return batch({
        case: 'advance one deal, read the forecast',
        emulated: null,
        arms: {
            'among 100': pipeline(100),
            'among 1,000': pipeline(1000),
        },
    })
}
