// SERVER REQUEST SCOPE — rpc-core §M2. The per-request ambient bundle that server-side
// accessors (request/cookies/server/context/identity/route) read from.
//
// A scope carries everything a handler needs about the current request: the raw Request,
// its cookies, the resolved identity, a free-form per-request bag, the route info, the Bun
// server, and the per-request read cache Map.
//
// runInScope activates BOTH the scope (via its own AsyncLocalStorage, so accessors can find
// it) AND the M1 cache context — sharing the SAME Map — so that getContext().cache (which the
// cell primitive reads) is identical to scope.cache. Entering them together keeps a cell load
// inside a request writing into that request's cache and nowhere else.

import { AsyncLocalStorage } from 'node:async_hooks'
import {
    type CacheContext,
    runInContext,
    runOutsideContext,
} from '../../shared/internal/context.ts'

export type RouteKind =
    | 'nav'
    | 'rpc'
    | 'socket-connect'
    | 'socket-subscribe'
    | 'socket-publish'
    | 'stream'

export interface RouteInfo {
    kind: RouteKind
    name: string
    params: Record<string, unknown>
    url: URL
    navigating: boolean
}

export interface Principal {
    id: string
    authenticated: boolean
    [k: string]: unknown
}

export interface RequestScope {
    request: Request
    cookies: Bun.CookieMap
    identity: Principal
    // identity.set()/clear() set `identityDirty` so the router re-seals (or clears) the rolling
    // abide-identity cookie after dispatch; `identityCleared` distinguishes logout (clear cookie)
    // from login/refresh (write cookie). `identityStateless` marks a machine-bearer request whose
    // identity is request-scoped and must never persist a cookie (AU6.3).
    identityDirty?: boolean
    identityCleared?: boolean
    identityStateless?: boolean
    bag: Record<string, unknown>
    route: RouteInfo
    server?: Bun.Server<undefined>
    cache: Map<string, unknown>
    // W3C Trace Context (CO2.3). Set by the router from the incoming `traceparent` header when
    // present; otherwise lazily generated + cached on the first `trace()` call within the scope so
    // it stays stable for the request's lifetime.
    traceparent?: string
}

// The anonymous-default identity stub (M2). Real cookie-sealed identity resolution is M7.
export function anonymousPrincipal(): Principal {
    return { id: crypto.randomUUID(), authenticated: false }
}

// Per-request scope storage. Separate from M1's cache context so accessors can retrieve the
// full scope while the cell primitive still sees only its cache context.
//
// AsyncLocalStorage is server-only (node:async_hooks). This module is reachable from the client
// bundle via the isomorphic route() (shared/route.ts imports currentScope), so the ALS must be
// LAZILY constructed and never instantiated in the browser — otherwise the client bundle throws
// `new AsyncLocalStorage` (undefined is not a constructor). Mirrors shared/internal/context.ts.
const isBrowser =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined'
let scopeStorage: AsyncLocalStorage<RequestScope> | undefined
function storage(): AsyncLocalStorage<RequestScope> | undefined {
    if (isBrowser) return undefined
    if (scopeStorage === undefined) scopeStorage = new AsyncLocalStorage<RequestScope>()
    return scopeStorage
}

export function runInScope<T>(scope: RequestScope, fn: () => T | Promise<T>): T | Promise<T> {
    // Share the exact same Map with the M1 cache context so getContext().cache === scope.cache.
    const context: CacheContext = { cache: scope.cache, states: [] }
    const store = storage()
    if (store === undefined) return runInContext(context, fn) // client fallback (no async isolation)
    return store.run(scope, () => runInContext(context, fn))
}

export function currentScope(): RequestScope | undefined {
    return storage()?.getStore()
}

// Run fn with NEITHER the request scope NOR the cache context active. The fail-closed lever for
// `shared` cells (rpc-core §2): a shared handler runs here so identity()/cookies()/request()/
// context() THROW if it touches request scope — the read rejects and the value is never cached, in
// dev AND prod. Exiting the cache context too routes any nested non-shared cell to the neutral
// default context instead of the request's Map. On the client this is a plain call.
export function runOutsideScope<T>(fn: () => T): T {
    const store = storage()
    if (store === undefined) return runOutsideContext(fn)
    return store.exit(() => runOutsideContext(fn))
}
