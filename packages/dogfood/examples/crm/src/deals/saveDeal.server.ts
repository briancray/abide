import { jsonSchema, refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

import { DEALS } from '../pipeline/lib/DEALS.server.ts'

type SavedDeal = { id: string; name: string; company: string; amount: number }

const SAVED_DEAL = jsonSchema<SavedDeal>({
    type: 'object',
    required: ['id', 'name', 'company', 'amount'],
    properties: {
        id: { type: 'string' },
        name: { type: 'string', minLength: 2 },
        company: { type: 'string', minLength: 2 },
        amount: { type: 'number', minimum: 1 },
    },
})

export const saveDeal = rpc(
    ({ id, name, company, amount }) => {
        const deal = DEALS.find((each) => each.id === id)
        if (deal === undefined) return refuse(404)
        Object.assign(deal, { name, company, amount })
        return { ...deal }
    },
    {
        methods: ['POST'],
        args: SAVED_DEAL,
        description: "Saves a deal's name, company and amount.",
    },
)
