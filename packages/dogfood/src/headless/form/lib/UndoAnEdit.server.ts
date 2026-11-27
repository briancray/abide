import { rpc } from '@abide/abide/server'

export const saveDeal = rpc((deal: { name: string }) => deal, {
    methods: ['POST'],
})
