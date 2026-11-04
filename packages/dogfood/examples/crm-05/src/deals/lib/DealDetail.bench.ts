import { reactive } from '@abide/abide'
import { batch, type Batched } from '@abide/harness/report'

// The detail as the card reads it, the handler's answers among `count` deals.
function picking(count: number): () => void {
    const answered: Record<string, { name: string; company: string }> = {}
    for (let at = 0; at < count; at += 1)
        answered[`d${at}`] = { name: `Deal ${at}`, company: `Company ${at}` }
    const id = reactive('d0')
    const deal = reactive(() => answered[id()])
    deal()
    // Back and forth between two deals, as the card's tabs pick.
    let picked = 'd0'
    return () => {
        picked = picked === 'd0' ? 'd1' : 'd0'
        id.set(picked)
        deal()
    }
}

// The most a pick may take among 1,000 deals, in milliseconds.
export const CEILINGS = { priced: { 'among 1,000': 1 } }

/** Picking a deal among 100, and among 1,000. */
export function priced(): Batched {
    return batch({
        case: 'pick a deal, read the one the handler answered',
        emulated: null,
        arms: {
            'among 100': picking(100),
            'among 1,000': picking(1000),
        },
    })
}
