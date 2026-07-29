// CLIENT IDENTITY HOLDER — the reactive source `identity()` reads in the BROWSER.
//
// On the server `identity()` reads the active request's scope. A tab has no request scope, so it reads
// this module-level reactive holder instead: the Principal the server resolved for the request that
// rendered the page, adopted at hydration. Reading it inside a binding SUBSCRIBES, so a login/logout
// that refreshes it re-runs every `identity()`-dependent binding — which is the whole point of making
// the accessor isomorphic rather than threading a prop down the tree.
//
// The browser never INVENTS an identity: the value always arrives from the server (the hydration seed,
// or a `/__abide/identity` refresh). A client-minted principal would name a user no server agrees
// exists. That rule is the shape of an ADOPTED AMBIENT (see `adoptedAmbient.ts`), shared with `route()`
// and `trace()`; this file is that shape's two parameters:
//
//   isValid — untrusted-shaped by construction (it comes off the wire), so anything without a string
//             `id` and a boolean `authenticated` is DROPPED and the previous identity stands.
//   changed — by VALUE, not object identity. Every navigation decodes a fresh principal out of its
//             seed, so an identity comparison would report a change on every nav to say nothing
//             changed. A principal is JSON-only by construction (it round-trips through the sealed
//             cookie), which makes stringify a fair comparison.
//
// Lives in `shared/internal` (not `ui`) so `shared/identity.ts` can read it without importing UI code;
// inert on the server, where nothing ever adopts.

import { adoptedAmbient } from './adoptedAmbient.ts'
import type { Principal } from './principal.ts'

const holder = adoptedAmbient<Principal>({
    isValid: (value): value is Principal =>
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Principal).id === 'string' &&
        typeof (value as Principal).authenticated === 'boolean',
    changed: (current, next) => JSON.stringify(current) !== JSON.stringify(next),
})

// Reactive read of the adopted identity. Tracks when called inside an effect/memo.
export function readClientIdentity(): Principal | undefined {
    return holder.read()
}

// Replace the adopted identity, waking every `identity()`-dependent binding — but ONLY when it says
// something different (see `changed` above).
export function setClientIdentity(principal: Principal): void {
    holder.adopt(principal)
}

// Reset the holder (tests, and any teardown that must not leak one run's identity into the next).
export function clearClientIdentity(): void {
    holder.clear()
}
