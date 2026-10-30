import { GET } from '@abide/abide/server'

import { DEALS } from './lib/DEALS.server.ts'

/** Answers at /reports/getSummary; the summary tiles and their test read it. */
export default GET(
    () => {
        let open = 0
        let pipeline = 0
        for (const deal of DEALS) {
            if (deal.stage === 'won') continue
            open += 1
            pipeline += deal.amount
        }
        return { open, pipeline }
    },
    { description: 'Open deals and their value.' },
)
