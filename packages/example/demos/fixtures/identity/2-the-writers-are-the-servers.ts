import { identity } from 'abide'

/**
 * On the way out of a sign-in: the claims are sealed into a cookie the client cannot forge, and every
 * later request is answered from it.
 *
 * Both writers are the SERVER's. A browser calling one gets a message rather than a different answer —
 * a client that could write its own principal is a client that decides who it is.
 */
export async function signIn(id: string, name: string): Promise<void> {
    await identity.set({ id, name })
}

export async function signOut(): Promise<void> {
    await identity.clear()
}
