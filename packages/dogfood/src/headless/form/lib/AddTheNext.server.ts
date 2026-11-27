import { rpc } from '@abide/abide/server'

export default rpc(({ name }: { name: string }) => ({ name }), {
    methods: ['POST'],
})
