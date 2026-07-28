// Adopt the principal the SERVER resolved onto the client holder, so `identity()` answers in the
// browser (the hydration seed on load and on a full soft-nav, a `/__abide/identity` fetch after a
// login mutation). The counterpart to `adoptTrace`, and untrusted-shaped for the same reason: the
// value comes off the wire, so anything without a string `id` is DROPPED rather than adopted, leaving
// the previous identity standing.
//
// Adopting an IDENTICAL principal is a no-op by value comparison, not by object identity: the seed
// decodes a fresh object on every navigation, and re-setting the cell would wake every `identity()`
// binding on each nav to say nothing changed.

import { setClientIdentity } from './identityHolder.ts'
import type { Principal } from './principal.ts'

export function adoptIdentity(principal: Principal | null | undefined): void {
    if (principal === null || principal === undefined) return
    if (typeof principal.id !== 'string' || typeof principal.authenticated !== 'boolean') return
    setClientIdentity(principal)
}
