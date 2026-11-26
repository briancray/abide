import { abortSignal, memo } from '@abide/abide'

import { DEALS } from '../../pipeline/lib/DEALS.server.ts'

/** The leads still waiting on a follow-up, looked at again five minutes after the last look while the panel is open. */
export const followUps = memo(
    async function* () {
        const stopping = abortSignal()
        for (const deal of DEALS) {
            if (stopping.aborted) return
            await Bun.sleep(1) // a look at the lead's inbox
            if (deal.stage === 'lead') yield deal.name
        }
    },
    { global: true, tags: ['follow-ups'], ttl: 300_000 },
)
