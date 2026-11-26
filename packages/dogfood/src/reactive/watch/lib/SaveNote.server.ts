import { rpc } from '@abide/abide/server'

export default rpc(({ note }: { id: string; note: string }) => note, {
    methods: ['POST'],
})
