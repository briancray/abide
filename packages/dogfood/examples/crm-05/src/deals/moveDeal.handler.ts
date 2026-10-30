import { jsonSchema, refuse } from '@abide/abide'
import { PATCH } from '@abide/abide/server'

import { DEALS } from './lib/DEALS.server.ts'

// A refusal with a name and typed data, which the page can match.
const dealClosed = refuse.named(
    'DealClosed',
    409,
    'A closed deal does not move.',
    { schema: jsonSchema<{ stage: string }>({ type: 'object' }) },
)

export default PATCH(
    ({ id, stage }: { id: string; stage: string }) => {
        const deal = DEALS.find((each) => each.id === id)
        if (deal === undefined) return refuse(404)
        if (deal.stage === 'won' || deal.stage === 'lost')
            return dealClosed({ stage: deal.stage })
        deal.stage = stage
        return { ...deal }
    },
    { description: 'Moves a deal to another stage, while it is open.' },
)
