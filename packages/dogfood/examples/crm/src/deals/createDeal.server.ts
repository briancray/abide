import { jsonSchema, refuse } from '@abide/abide'
import { rpc } from '@abide/abide/server'

import { DEALS } from '../pipeline/lib/DEALS.server.ts'

type NewDeal = { name: string; company: string; amount: number }

// Checked before the handler runs; a refusal names the field.
const NEW_DEAL = jsonSchema<NewDeal>({
    type: 'object',
    required: ['name', 'company', 'amount'],
    properties: {
        name: { type: 'string', minLength: 2 },
        company: { type: 'string', minLength: 2 },
        amount: { type: 'number', minimum: 1 },
    },
})

// A refusal that names no field: the deal is whole, and another holds its name.
const nameTaken = refuse.named('NameTaken', {
    status: 409,
    message: 'A deal of that name is open.',
})

export default rpc(
    ({ name, company, amount }) => {
        if (DEALS.some((each) => each.name === name)) return nameTaken()
        // Every caller shares one list: past ten, the newest replaces the last.
        if (DEALS.length >= 10) DEALS.pop()
        const deal = {
            id: `d${DEALS.length + 1}`,
            name,
            company,
            amount,
            stage: 'lead',
        }
        DEALS.push(deal)
        return { ...deal }
    },
    {
        methods: ['POST'],
        args: NEW_DEAL,
        description: 'Adds a deal, as a lead.',
    },
)
