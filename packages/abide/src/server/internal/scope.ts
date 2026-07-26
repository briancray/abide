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
    getContext,
    type MemoContext,
    runInContext,
} from '../../shared/internal/context.ts'
import type { RouteInfo, RouteKind } from '../../shared/internal/routeInfo.ts'

// `RouteInfo`/`RouteKind` moved to `shared/internal/` (ADR 0026) so `shared/route.ts` can name the type
// it returns without importing up. Re-exported here because every server + ui importer already reaches
// them through this module.
export type { RouteInfo, RouteKind }

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
    // `identityDirty` marks a login (`identity.set()`), which must ALWAYS write the cookie regardless
    // of how much of the incoming one's lifetime is left. `identityExpiresAt` is the incoming cookie's
    // `exp` (undefined when there was no readable cookie); together they let the router skip the
    // AES-GCM re-seal on the overwhelming majority of responses, where a live cookie already says the
    // same thing. Always present on a router-built scope so the shape stays stable.
    identityDirty?: boolean
    identityExpiresAt?: number | undefined
    bag: Record<string, unknown>
    route: RouteInfo
    server?: Bun.Server<undefined>
    slots: Map<string, unknown>
    // W3C Trace Context (CO2.3). The router's SEED from an incoming `traceparent` header, copied onto
    // the reactive context by `runInScope`. Since ADR 0026 the context is the mutable home — `trace()`
    // generates and caches there, and the router's `finalize` reads it back from there — so this field
    // is write-once at construction and never updated afterwards.
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
// EAGER since ADR 0026. It used to be lazily constructed behind an `isBrowser` guard because
// `shared/route.ts` imported `currentScope`, dragging this server-only module (and
// `node:async_hooks`) into the client bundle. Nothing in `shared/` imports it any more, so the
// guard — and the client-fallback branches it forced through `runInScope`/`runOutsideScope` — are gone.
const scopeStorage = new AsyncLocalStorage<RequestScope>()

export function runInScope<T>(scope: RequestScope, fn: () => T | Promise<T>): T | Promise<T> {
    // Share the exact same Map with the M1 cache context so getContext().slots === scope.slots. That
    // identity is no longer a convenience: `currentScope()` USES it to decide whether the ambient scope
    // still belongs to the active context, which is what makes the shared-memo fail-closed guarantee
    // structural (see below). The three isomorphic facts ride the context so `shared/` can read them
    // without importing this module (ADR 0026).
    const context: MemoContext = {
        slots: scope.slots,
        states: {},
        requestScoped: true,
        route: scope.route,
        traceparent: scope.traceparent,
    }
    const result = scopeStorage.run(scope, () =>
        runInContext(context, () => {
            // The fail-closed guarantee now RESTS on this identity (see `currentScope`), where it used
            // to rest on a comment. If a future edit builds the context with its own Map, every
            // request-scope accessor silently starts throwing inside a live request — a failure that
            // would surface as an unexplained 500 far from here. Assert it once, at entry, in dev.
            if (Bun.env.NODE_ENV !== 'production' && scope.slots !== getContext().slots) {
                throw new Error(
                    'runInScope: the request scope and its reactive context must share one slots Map',
                )
            }
            return fn()
        }),
    )
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

// The active request scope — but ONLY while the active reactive context is still the one it was
// entered with (ADR 0026).
//
// This is the fail-closed lever for `shared` memos (rpc-core §2), and it is now STRUCTURAL rather than
// maintained by entering and exiting two things in lockstep. A shared handler runs under
// `runOutsideContext`, which swaps the active context for the neutral default; its `slots` Map is a
// different Map, so the identity below fails and every request-scope accessor —
// identity()/cookies()/request()/context() — throws. The read rejects and the value is never cached,
// in dev AND prod. There is no longer a `runOutsideScope` to forget to call.
//
// The `undefined` short-circuit matters: it answers "no scope" without calling `getContext()`, which
// would install the process-global default context as a side effect of a read-only question.
export function currentScope(): RequestScope | undefined {
    const scope = scopeStorage.getStore()
    if (scope === undefined) return undefined
    return scope.slots === getContext().slots ? scope : undefined
}
