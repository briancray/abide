import { reactive } from '@abide/abide'
import { batch, type Batched } from '@abide/harness/report'

import { advance, type Deal, forecast } from './forecast.ts'

// The forecast as the card keeps it, over a pipeline of `count` deals.
function pipeline(count: number): () => void {
    const opening: Deal[] = []
    for (let at = 0; at < count; at += 1)
        opening.push({ company: `Company ${at}`, amount: 1000, stage: 'lead' })
    const deals = reactive(opening)
    const expected = reactive(() => forecast(deals()))
    expected()
    return () => {
        deals.set(advance(deals(), 0))
        expected()
    }
}

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
