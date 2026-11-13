import { POST } from '@abide/abide/server'

import { DEALS } from './lib/DEALS.server.ts'

/** Moves the first open lead to qualified, and answers with its id. */
export default POST(
    () => {
        const deal = DEALS.find((each) => each.stage === 'lead')
        if (deal) deal.stage = 'qualified'
        return deal?.id ?? null
    },
    {
        description: 'Qualifies the first open lead.',
        refreshes: ['stage:lead', 'stage:qualified'],
    },
)
