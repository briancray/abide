import { rpc } from '@abide/abide/server'

export const addDeal = rpc(({ name }: { name: string }) => ({ name }), {
    methods: ['POST'],
})
