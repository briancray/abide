import { principal } from '@abide/abide'
import { rpc } from '@abide/abide/server'

export default rpc(() => principal.clear(), {
    methods: ['POST'],
    description: 'Signs out.',
})
