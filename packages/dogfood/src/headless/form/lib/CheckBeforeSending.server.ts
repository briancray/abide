import { jsonSchema } from '@abide/abide'
import { rpc } from '@abide/abide/server'

type Deal = { name: string; amount: number }

const DEAL = jsonSchema<Deal>({
    type: 'object',
    required: ['name', 'amount'],
    properties: {
        name: { type: 'string', minLength: 2 },
        amount: { type: 'number', minimum: 1 },
    },
})

export default rpc((deal: Deal) => deal, {
    methods: ['POST'],
    args: DEAL,
})
