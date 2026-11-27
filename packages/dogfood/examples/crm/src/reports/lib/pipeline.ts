import { reactive } from '@abide/abide'

import { advance, type Deal, forecast } from './forecast.ts'

/** The forecast as the card keeps it, over `count` deals: one call advances a deal and reads it. */
export function pipeline(count: number): () => void {
    const opening: Deal[] = []
    for (let at = 0; at < count; at += 1)
        opening.push({ company: `Company ${at}`, amount: 1000, stage: 'lead' })
    const deals = reactive(opening)
    const expected = reactive(() => forecast(deals.get()))
    expected.get()
    return () => {
        deals.set(advance(deals.get(), 0))
        expected.get()
    }
}
