import { format } from '@abide/abide'
import { batch, type Batched } from '@abide/harness/report'

// A pipeline of `count` deals, each row's amount and chance written.
function formatting(count: number): () => void {
    const deals: { amount: number; probability: number }[] = []
    for (let at = 0; at < count; at += 1)
        deals.push({ amount: 1000 + at * 250, probability: (at % 10) / 10 })
    return () => {
        for (const deal of deals) {
            format.money(deal.amount, { maximumFractionDigits: 0 })
            format.percent(deal.probability)
        }
    }
}

// The most writing a pipeline of 1,000 deals may take, in milliseconds.
export const CEILINGS = { priced: { 'of 1,000 deals': 5 } }

/** Writing every row's figures, in a pipeline of 100 deals and of 1,000. */
export function priced(): Batched {
    return batch({
        case: "write each deal's amount and chance",
        emulated: null,
        arms: {
            'of 100 deals': formatting(100),
            'of 1,000 deals': formatting(1000),
        },
    })
}
