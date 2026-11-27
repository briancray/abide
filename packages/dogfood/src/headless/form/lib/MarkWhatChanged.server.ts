import { rpc } from '@abide/abide/server'

export const saveDeal = rpc((deal: { name: string; amount: number }) => deal, {
    methods: ['POST'],
})
