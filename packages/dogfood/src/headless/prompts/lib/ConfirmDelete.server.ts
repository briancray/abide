import { rpc } from '@abide/abide/server'

export const deleteDeal = rpc(({ id }: { id: string }) => id, {
    methods: ['POST'],
})
