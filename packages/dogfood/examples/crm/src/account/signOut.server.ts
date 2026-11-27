import { principal } from '@abide/abide'
import { rpc } from '@abide/abide/server'

export const signOut = rpc(() => principal.clear(), {
    methods: ['POST'],
    description: 'Signs out.',
})
