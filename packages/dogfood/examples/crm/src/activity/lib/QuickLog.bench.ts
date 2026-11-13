import { reactive } from '@abide/abide'
import { batch, type Batched } from '@abide/harness/report'

import type { Activity } from './activity.ts'

// The channel as the card logs to it: `count` entries, the oldest let go.
function logging(count: number): () => void {
    const opening: Activity[] = []
    for (let at = 0; at < count; at += 1)
        opening.push({ id: at, contact: `Contact ${at}`, kind: 'Email' })
    const activity = reactive(opening)
    const last = reactive(() => activity().at(-1))
    last()
    return () => {
        activity.patch((entries) => {
            entries.push({
                id: (entries.at(-1)?.id ?? 0) + 1,
                contact: 'Grace Hopper',
                kind: 'Call',
            })
            entries.shift()
        })
        last()
    }
}

// The most a log may take in a channel of 1,000 entries, in milliseconds.
export const CEILINGS = { priced: { 'of 1,000 entries': 1 } }

/** Logging a call to a channel of 100 entries, and of 1,000. */
export function priced(): Batched {
    return batch({
        case: 'log a call, read the last touch',
        emulated: null,
        arms: {
            'of 100 entries': logging(100),
            'of 1,000 entries': logging(1000),
        },
    })
}
