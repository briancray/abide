import { reactive } from '@abide/abide'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

/** Every five minutes: the leads still waiting on a follow-up. */
export const followUps = reactive(
    async function* () {
        for (const deal of DEALS) {
            await Bun.sleep(1) // a look at the lead's inbox
            if (deal.stage === 'lead') yield deal.name
        }
    },
    { global: true, poll: 300_000 },
)
