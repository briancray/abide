import { identity } from 'abide'
import { POST } from 'abide/server'

/**
 * On the way out of a sign-in: the claims are sealed into a cookie the client cannot forge, and every
 * later request is answered from it.
 *
 * Both writers are the SERVER's, which is why this is an endpoint rather than something the browser
 * half beside it could call directly — a client that could write its own principal is a client that
 * decides who it is. Calling `identity.set` in a browser is refused with a message saying so, and the
 * preview presses that button too.
 */
export const signIn = POST(async ({ id }: { id: string }) => {
    await identity.set({ id })
    return { sealed: id }
})

export const signOut = POST(async () => {
    await identity.clear()
    return { sealed: null }
})
