// THE IDENTITY AMBIENT (auth.md AU3) — what `identity()` reads, on both sides.
//
// On the SERVER the active request's scope carries the principal the bearer/cookie ladder resolved
// before any handler ran. A tab has no request scope, so the read falls through to the principal the
// server resolved for the request that rendered the page, adopted at hydration. Reading it inside a
// binding SUBSCRIBES, so a login/logout that refreshes it re-runs every `identity()`-dependent binding
// — which is the whole point of making the accessor isomorphic rather than threading a prop down.
//
// The browser never INVENTS an identity: the value always arrives from the server (the hydration seed,
// or a `/__abide/identity` refresh). A client-minted principal would name a user no server agrees
// exists. That rule is the shape of an ADOPTED AMBIENT (see `adoptedAmbient.ts`); this file is that
// shape's parameters:
//
//   isValid — untrusted-shaped by construction (it comes off the wire), so anything without a string
//             `id` and a boolean `authenticated` is DROPPED and the previous identity stands.
//   changed — by VALUE, not object identity. Every navigation decodes a fresh principal out of its
//             seed, so an identity comparison would report a change on every nav to say nothing
//             changed. A principal is JSON-only by construction (it round-trips through the sealed
//             cookie), which makes stringify a fair comparison.
//   absent  — the asymmetric one. In the BROWSER, a frozen anonymous floor: "nobody proved anything"
//             is an answer, not an absence, so no caller needs a null check. On the SERVER it THROWS,
//             and that is load-bearing rather than pedantry — a `memo({ crossRequest: true })` body
//             runs scope-EXITED precisely so touching this fails closed (rpc-core checkpoint (a)), and
//             an anonymous fallback there would turn a loud error into a silent cross-user leak. The
//             browser has no such thing as "outside a request", so the floor is right there and only
//             there.

import { adoptedAmbient } from './adoptedAmbient.ts'
import { isBrowser } from './isBrowser.ts'
import type { Principal } from './principal.ts'
import { peekReactiveScope } from './reactiveScope.ts'

// The floor the browser answers with before anything has been adopted. One frozen object rather than a
// fresh `anonymousPrincipal()` per call: a new id on every read would make `identity().id` unstable and
// wake value-comparing readers forever.
const NOT_YET_KNOWN: Principal = Object.freeze({ id: '', authenticated: false })

export const identityAmbient = adoptedAmbient<Principal, Principal>({
    isValid: (value): value is Principal =>
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Principal).id === 'string' &&
        typeof (value as Principal).authenticated === 'boolean',
    changed: (current, next) => JSON.stringify(current) !== JSON.stringify(next),
    fromScope: () => peekReactiveScope()?.identity,
    absent: () => {
        if (isBrowser) return NOT_YET_KNOWN
        throw new Error('identity(): no active request scope — call it inside a request handler.')
    },
})
