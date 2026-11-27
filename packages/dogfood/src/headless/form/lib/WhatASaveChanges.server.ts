import { jsonSchema } from '@abide/abide'
import { rpc } from '@abide/abide/server'

type Deal = { name: string; company: string; amount: number }

export const saveDeal = rpc((deal: Deal) => deal, {
    methods: ['POST'],
    args: jsonSchema<Deal>({
        type: 'object',
        properties: {
            name: { type: 'string' },
            company: { type: 'string' },
            amount: { type: 'number' },
        },
    }),
})
