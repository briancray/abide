import { jsonSchema } from '@abide/abide'
import { POST } from '@abide/abide/server'
import { DEALS } from './server/DEALS.ts'

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

export default POST(
    ({ name, company, amount }: NewDeal) => {
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
    { args: NEW_DEAL, description: 'Adds a deal, as a lead.' },
)
