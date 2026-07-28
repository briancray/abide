// CLIENT IDENTITY HOLDER — the reactive source `identity()` reads in the BROWSER.
//
// On the server `identity()` reads the active request's scope. A tab has no request scope, so it reads
// this module-level reactive holder instead: one `state` holding the Principal the server resolved for
// the request that rendered the page, adopted at hydration. Reading it inside a binding SUBSCRIBES, so
// a login/logout that refreshes it re-runs every `identity()`-dependent binding — which is the whole
// point of making the accessor isomorphic rather than threading a prop down the tree.
//
// The browser never INVENTS an identity: the value always arrives from the server (the hydration seed,
// or a `/__abide/identity` refresh). A client-minted principal would name a user no server agrees
// exists. Lives in `shared/internal` (not `ui`) so `shared/identity.ts` can read it without importing
// UI code; inert on the server, where nothing ever adopts. Shaped after `routeHolder.ts`, which solves
// the identical problem for `route()`.

import type { Principal } from './principal.ts'
import { state } from './reactive.ts'

const clientIdentity = state<Principal | undefined>(undefined)

// Reactive read of the adopted identity. Tracks when called inside an effect/memo.
export function readClientIdentity(): Principal | undefined {
    return clientIdentity()
}

// Replace the adopted identity, waking every `identity()`-dependent binding — but ONLY when it says
// something different. Every navigation decodes a fresh principal object out of its seed, so an
// identity-based cell would report a change on every nav; a principal is JSON-only by construction
// (it round-trips through the sealed cookie), which makes stringify a fair value comparison.
export function setClientIdentity(principal: Principal): void {
    const current = clientIdentity.untracked()
    if (current !== undefined && JSON.stringify(current) === JSON.stringify(principal)) return
    clientIdentity.set(principal)
}

// Reset the holder (tests, and any teardown that must not leak one run's identity into the next).
export function clearClientIdentity(): void {
    clientIdentity.set(undefined)
}
