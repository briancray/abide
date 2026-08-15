import { onIdentity } from 'abide/server'

/**
 * The half only the server can supply, installed the way `onHealth` is: `identity()` is the same call
 * on both sides, and this is what answers it.
 *
 * OPTIONAL. Without a resolver the sealed claims ARE the principal, which is the whole of what a small
 * app needs — `identity.set({ id, name })` and `identity()` hands both back. A resolver is what an app
 * reaches for when the COOKIE should carry an id and the PRINCIPAL should carry a row: the cookie
 * stays small and the row stays current, because it is read per request rather than sealed once.
 */
onIdentity(async (claims) => {
    const { id } = claims as { id: string }
    const row = await Promise.resolve({ name: `user ${id}`, roles: ['reader'] })
    return { id, name: row.name, roles: row.roles }
})
