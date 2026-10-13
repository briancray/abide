import { principal } from '@abide/abide'
import { POST } from '@abide/abide/server'

export const signIn = POST(() => principal.set({ id: 'ada' }), {
    description: 'Signs in as Ada.',
})

export const signOut = POST(() => principal.clear(), {
    description: 'Signs out.',
})
