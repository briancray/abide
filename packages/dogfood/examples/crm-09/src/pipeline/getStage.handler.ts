import { GET } from '@abide/abide/server'

import { DEALS } from './lib/DEALS.server.ts'
import { LOADS } from './lib/LOADS.server.ts'

/** Takes args, so it is keyed: one entry per stage. */
export default GET(
    async ({ stage }: { stage: string }) => {
        // A slow database, so the wait is on screen.
        await Bun.sleep(400)
        LOADS[stage] = (LOADS[stage] ?? 0) + 1
        let count = 0
        let value = 0
        for (const deal of DEALS)
            if (deal.stage === stage) {
                count += 1
                value += deal.amount
            }
        return { count, value }
    },
    { description: 'How many deals one stage holds, and their value.' },
)
