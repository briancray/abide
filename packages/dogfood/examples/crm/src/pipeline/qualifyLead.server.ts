import { rpc } from '@abide/abide/server'

import { DEALS } from './lib/DEALS.server.ts'

/** Moves the first open lead to qualified, and answers with its id. */
export const qualifyLead = rpc(
    () => {
        const deal = DEALS.find((each) => each.stage === 'lead')
        if (deal) deal.stage = 'qualified'
        return deal?.id ?? null
    },
    {
        methods: ['POST'],
        description: 'Qualifies the first open lead.',
        refreshes: ['stage:lead', 'stage:qualified'],
    },
)
