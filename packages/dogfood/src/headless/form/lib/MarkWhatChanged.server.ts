import { rpc } from '@abide/abide/server'

export default rpc((deal: { name: string; amount: number }) => deal, {
    methods: ['POST'],
})
