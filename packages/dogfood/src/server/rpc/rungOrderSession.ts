import { principal } from 'abide'
import { POST } from 'abide/server'

export const signIn = POST(() => principal.set({ id: 'ada' }), {
    description: 'Signs in as Ada.',
})

export const signOut = POST(() => principal.clear(), {
    description: 'Signs out.',
})
