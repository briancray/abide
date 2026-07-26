// SERVER REQUEST SCOPE — rpc-core §M2. The per-request ambient bundle that server-side
// accessors (request/cookies/server/context/identity/route) read from.
//
// A scope carries everything a handler needs about the current request: the raw Request,
// its cookies, the resolved identity, a free-form per-request bag, the route info, the Bun
// server, and the per-request read cache Map.
//
// runInScope activates BOTH the scope (via its own AsyncLocalStorage, so accessors can find
// it) AND the M1 cache context — sharing the SAME Map — so that getContext().slots (which the
// memo primitive reads) is identical to scope.slots. Entering them together keeps a memo load
// inside a request writing into that request's cache and nowhere else.

import { AsyncLocalStorage } from 'node:async_hooks'
import {
    disposeContext,
    type MemoContext,
    runInContext,
    runOutsideContext,
} from '../../shared/internal/context.ts'
import { isBrowser } from '../../shared/internal/isBrowser.ts'

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
    // The router re-seals the rolling abide-identity cookie after every dispatch; `identityCleared`
    // distinguishes logout (clear the cookie) from login/refresh (write it). `identityStateless` marks
    // a machine-bearer request whose identity is request-scoped and must never persist a cookie (AU6.3).
    //
    // Both are always PRESENT on a router-built scope (`false` when unset) rather than added later, so
    // the per-request scope object — which every ambient accessor reads — keeps one hidden class.
    identityCleared?: boolean
    identityStateless?: boolean
    bag: Record<string, unknown>
    route: RouteInfo
    server?: Bun.Server<undefined>
    slots: Map<string, unknown>
    // W3C Trace Context (CO2.3). Set by the router from the incoming `traceparent` header when
    // present; otherwise lazily generated + cached on the first `trace()` call within the scope so
    // it stays stable for the request's lifetime.
    // Explicitly `| undefined` (not just optional): the router always SETS this key, to `undefined` when
    // there is no incoming header, so the scope object is built in one shape. Under
    // `exactOptionalPropertyTypes` a bare `?:` would reject that assignment.
    traceparent?: string | undefined
}

// The anonymous-default identity stub (M2). Real cookie-sealed identity resolution is M7.
export function anonymousPrincipal(): Principal {
    return { id: crypto.randomUUID(), authenticated: false }
}

// Per-request scope storage. Separate from M1's cache context so accessors can retrieve the
// full scope while the memo primitive still sees only its cache context.
//
// AsyncLocalStorage is server-only (node:async_hooks). This module is reachable from the client
// bundle via the isomorphic route() (shared/route.ts imports currentScope), so the ALS must be
// LAZILY constructed and never instantiated in the browser — otherwise the client bundle throws
// `new AsyncLocalStorage` (undefined is not a constructor).
let scopeStorage: AsyncLocalStorage<RequestScope> | undefined
function storage(): AsyncLocalStorage<RequestScope> | undefined {
    if (isBrowser) return undefined
    if (scopeStorage === undefined) scopeStorage = new AsyncLocalStorage<RequestScope>()
    return scopeStorage
}

export function runInScope<T>(scope: RequestScope, fn: () => T | Promise<T>): T | Promise<T> {
    // Share the exact same Map with the M1 cache context so getContext().slots === scope.slots.
    const context: MemoContext = { slots: scope.slots, states: [] }
    const store = storage()
    const run = (): T | Promise<T> =>
        store === undefined
            ? runInContext(context, fn) // client fallback (no async isolation)
            : store.run(scope, () => runInContext(context, fn))
    const result = run()
    // Tear the request's context-scoped reactive nodes down once its work is finished. A STREAMING page
    // reply is not finished here — its drain runs off the response body — so that one disposes itself at
    // the end of the drain (`renderDocumentStream`), which is also where the stream scope is cleared.
    if (result instanceof Promise) {
        return result.finally(() => {
            if (context.stream === undefined) disposeContext(context)
        }) as Promise<T>
    }
    if (context.stream === undefined) disposeContext(context)
    return result
}

export function currentScope(): RequestScope | undefined {
    return storage()?.getStore()
}

// Run fn with NEITHER the request scope NOR the cache context active. The fail-closed lever for
// `shared` memos (rpc-core §2): a shared handler runs here so identity()/cookies()/request()/
// context() THROW if it touches request scope — the read rejects and the value is never cached, in
// dev AND prod. Exiting the cache context too routes any nested non-shared memo to the neutral
// default context instead of the request's Map. On the client this is a plain call.
export function runOutsideScope<T>(fn: () => T): T {
    const store = storage()
    if (store === undefined) return runOutsideContext(fn)
    return store.exit(() => runOutsideContext(fn))
}
