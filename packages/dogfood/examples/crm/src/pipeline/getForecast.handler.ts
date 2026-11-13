import { GET } from '@abide/abide/server'

import { DEALS } from './lib/DEALS.server.ts'
import { LOADS } from './lib/LOADS.server.ts'

// How likely a deal in each stage is to close.
const ODDS: Record<string, number> = {
    lead: 0.1,
    qualified: 0.3,
    proposal: 0.6,
    won: 1,
}

/** The pipeline's value, weighted by how likely each deal is to close. */
export default GET(
    async () => {
        // A slow report, so the wait is on screen.
        await Bun.sleep(500)
        LOADS.forecast = (LOADS.forecast ?? 0) + 1
        let forecast = 0
        for (const deal of DEALS)
            forecast += deal.amount * (ODDS[deal.stage] ?? 0)
        return Math.round(forecast)
    },
    { description: 'The weighted pipeline forecast.' },
)
