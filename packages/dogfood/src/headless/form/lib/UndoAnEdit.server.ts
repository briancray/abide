import { rpc } from '@abide/abide/server'

export default rpc((deal: { name: string }) => deal, {
    methods: ['POST'],
})
