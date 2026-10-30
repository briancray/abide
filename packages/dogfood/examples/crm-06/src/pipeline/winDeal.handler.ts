import { POST } from '@abide/abide/server'
import { DEALS } from './lib/DEALS.server.ts'

/** Moves the first open lead to won, and answers with its id. */
export default POST(
    () => {
        const deal = DEALS.find((each) => each.stage === 'lead')
        if (deal) deal.stage = 'won'
        return deal?.id ?? null
    },
    { description: 'Wins the first open lead.' },
)
