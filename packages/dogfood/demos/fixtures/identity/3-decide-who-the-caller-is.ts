/**
 * The half only the server can supply, installed the way `onHealth` is: `identity()` is the same call
 * on both sides, and this is what answers it.
 *
 * OPTIONAL. Without a resolver the sealed claims ARE the principal, which is the whole of what a small
 * app needs — `identity.set({ id, name })` and `identity()` hands both back. A resolver is what an app
 * reaches for when the COOKIE should carry an id and the PRINCIPAL should carry a row: the cookie
 * stays small and the row stays current, because it is read per request rather than sealed once.
 *
 * An app EXPORT, the form the boot registers. `packages/dogfood/app.ts` carries this one, and the
 * empty object is what makes it safe to carry: a caller with no seal arrives here with `null` claims,
 * and merging nothing over the floor leaves anonymous exactly as it was.
 */
export function onIdentity(claims: unknown): unknown {
    const { id } = (claims ?? {}) as { id?: string }
    if (id === undefined) return {}
    return { name: `user ${id}`, roles: ['reader'] }
}
