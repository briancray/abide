import { reactive } from '@abide/abide'
import { batch, type Batched } from '@abide/harness/report'

// The list as the card reads it, once the handler answered `count` contacts.
function landed(count: number): () => void {
    const answered: { id: string; name: string; company: string }[] = []
    for (let at = 0; at < count; at += 1)
        answered.push({
            id: `c${at}`,
            name: `Contact ${at}`,
            company: `Company ${at}`,
        })
    const contacts = reactive(() => answered)
    contacts()
    return () => {
        contacts()
    }
}

// The most a read may take among 1,000 contacts, in milliseconds.
export const CEILINGS = { priced: { 'among 1,000': 1 } }

/** Reading the landed list among 100 contacts, and among 1,000. */
export function priced(): Batched {
    return batch({
        case: 'read the contacts the handler answered',
        emulated: null,
        arms: {
            'among 100': landed(100),
            'among 1,000': landed(1000),
        },
    })
}
