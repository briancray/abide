import { rpc } from '@abide/abide/server'

export default rpc(({ id }: { id: string }) => id, {
    methods: ['POST'],
})
