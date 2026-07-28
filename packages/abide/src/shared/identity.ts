// identity() — WHO the caller is (auth.md AU3). Isomorphic: same import, same call, both sides.
//
// SERVER: the principal the bearer/cookie ladder resolved before any handler ran, read off the request's
// reactive scope (ADR 0026 — `shared/` names nothing in `server/`).
// CLIENT: the principal the SERVER resolved for the request that rendered this page, adopted at
// hydration and re-adopted on navigation. Reactive — reading it in a binding subscribes, so a login or
// logout that refreshes it re-renders every dependent.
//
// Never null WHERE IT ANSWERS: "nobody proved anything" is an answer (`{ id, authenticated: false }`),
// not an absence, so no caller needs a null check. Before a page hydrates the browser's answer is a
// stable anonymous principal — bootstrap adopts the seed BEFORE mounting, so component code never sees
// that floor; only something running at module load, ahead of the mount, can.
//
// On the SERVER, outside a request, it THROWS instead — and that is load-bearing, not pedantry. A
// `memo({ crossRequest: true })` body runs scope-EXITED precisely so that touching an ambient like this
// one fails closed (rpc-core fail-closed checkpoint (a)): the first caller's identity must never be
// baked into a value later callers are served. An anonymous fallback there would turn a loud error into
// a silent cross-user leak. The browser has no such thing as "outside a request", so the floor is the
// right answer there and only there.
//
// The WRITES are isomorphic in name only, and deliberately so:
//   `set` / `clear` need the identity secret and the outgoing response, so they run on the server and
//   throw in the browser naming the fix. A client that could authenticate itself would be a client
//   that could forge an identity — the round trip through a mutation IS the security boundary.
//   `refresh` is the browser's half: re-ask the server who this caller is now (after a login mutation
//   has changed the cookie) and wake every reader. On the server it is a no-op, since the scope was
//   resolved from the live request and cannot be stale.

import { adoptIdentity } from './internal/adoptIdentity.ts'
import { IDENTITY_ROUTE } from './internal/IDENTITY_ROUTE.ts'
import { readClientIdentity } from './internal/identityHolder.ts'
import { isBrowser } from './internal/isBrowser.ts'
import type { Principal } from './internal/principal.ts'
import { peekReactiveScope } from './internal/reactiveScope.ts'

// The floor the browser answers with before anything has been adopted. One frozen object rather than a
// fresh `anonymousPrincipal()` per call: a new id on every read would make `identity().id` unstable and
// wake value-comparing readers forever.
const NOT_YET_KNOWN: Principal = Object.freeze({ id: '', authenticated: false })

// Whether this caller is on the CLIENT side of the isomorphism. `isBrowser` is the honest answer in a
// real browser; an ADOPTED identity is the answer everywhere the client runtime is exercised without a
// `window` (the test suite, a DOM emulator), and it is a sound one — only the client holder is ever
// adopted into. Used solely to pick which mistake the error message names.
function onClientSide(): boolean {
    return isBrowser || readClientIdentity() !== undefined
}

function writer(): (next: Partial<Principal> | undefined) => void {
    const write = peekReactiveScope()?.identityWrite
    if (write === undefined) {
        throw new Error(
            onClientSide()
                ? 'identity.set()/clear(): a browser cannot seal an identity — call it inside an rpc (a login/logout mutation), then `identity.refresh()`.'
                : 'identity.set()/clear(): no active request scope — call it inside a request handler.',
        )
    }
    return write
}

export const identity: {
    (): Principal
    set(p: Partial<Principal>): void
    clear(): void
    refresh(): Promise<Principal>
} = Object.assign(
    (): Principal => {
        const active = peekReactiveScope()?.identity
        if (active !== undefined) return active
        const adopted = readClientIdentity()
        if (adopted !== undefined) return adopted
        if (isBrowser) return NOT_YET_KNOWN
        throw new Error('identity(): no active request scope — call it inside a request handler.')
    },
    {
        set(p: Partial<Principal>): void {
            writer()(p)
        },
        clear(): void {
            writer()(undefined)
        },
        // Re-ask the server. The identity cookie is HttpOnly, so a browser cannot read who it has
        // become after a login mutation — only the server can say, and this is the asking.
        async refresh(): Promise<Principal> {
            const scoped = peekReactiveScope()?.identity
            if (scoped !== undefined) return scoped
            const response = await fetch(IDENTITY_ROUTE, {
                headers: { accept: 'application/json' },
            })
            if (!response.ok) return identity()
            const principal = (await response.json()) as Principal
            adoptIdentity(principal)
            return identity()
        },
    },
)
