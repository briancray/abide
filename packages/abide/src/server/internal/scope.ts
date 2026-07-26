// SERVER REQUEST SCOPE — rpc-core §M2. The per-request ambient bundle that server-side
// accessors (request/cookies/server/context/identity/route) read from.
//
// A scope carries everything a handler needs about the current request: the raw Request,
// its cookies, the resolved identity, a free-form per-request bag, the route info, the Bun
// server, and the per-request read cache Map.
//
// runInScope activates BOTH the scope (via its own AsyncLocalStorage, so accessors can find
// it) AND the M1 reactive scope — sharing the SAME Map — so that reactiveScope().slots (which the
// memo primitive reads) is identical to scope.slots. Entering them together keeps a memo load
// inside a request writing into that request's cache and nowhere else.

import { AsyncLocalStorage } from 'node:async_hooks'
import {
    enterScope,
    type ReactiveScope,
    reactiveScope,
    releaseScope,
} from '../../shared/internal/reactiveScope.ts'
import type { RouteInfo, RouteKind } from '../../shared/internal/routeInfo.ts'
import { log } from '../../shared/log.ts'

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
    // the reactive scope by `runInScope`. Since ADR 0026 the context is the mutable home — `trace()`
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

// Per-request scope storage. Separate from M1's reactive scope so accessors can retrieve the
// full scope while the memo primitive still sees only its reactive scope.
//
// EAGER since ADR 0026. It used to be lazily constructed behind an `isBrowser` guard because
// `shared/route.ts` imported `currentScope`, dragging this server-only module (and
// `node:async_hooks`) into the client bundle. Nothing in `shared/` imports it any more, so the
// guard — and the client-fallback branches it forced through `runInScope`/`runOutsideScope` — are gone.
const scopeStorage = new AsyncLocalStorage<RequestScope>()

export function runInScope<T>(scope: RequestScope, fn: () => T | Promise<T>): T | Promise<T> {
    // Share the exact same Map with the M1 reactive scope so reactiveScope().slots === scope.slots. That
    // identity is no longer a convenience: `currentScope()` USES it to decide whether the ambient scope
    // still belongs to the active context, which is what makes the shared-memo fail-closed guarantee
    // structural (see below). The three isomorphic facts ride the context so `shared/` can read them
    // without importing this module (ADR 0026).
    const context: ReactiveScope = {
        slots: scope.slots,
        requestScoped: true,
        route: scope.route,
        traceparent: scope.traceparent,
    }
    const result = scopeStorage.run(scope, () =>
        enterScope(context, () => {
            // The fail-closed guarantee now RESTS on this identity (see `currentScope`), where it used
            // to rest on a comment. If a future edit builds the context with its own Map, every
            // request-scope accessor silently starts throwing inside a live request — a failure that
            // would surface as an unexplained 500 far from here. Assert it once, at entry, in dev.
            if (Bun.env.NODE_ENV !== 'production' && scope.slots !== reactiveScope().slots) {
                throw new Error(
                    'runInScope: the request scope and its reactive scope must share one slots Map',
                )
            }
            return fn()
        }),
    )
    // Release the hold this call implicitly took. That tears the request's context-scoped reactive nodes
    // down UNLESS someone else retained it — which a streamed page reply does, because its drain runs off
    // the response body and is not finished here. `runInScope` no longer knows that streaming exists
    // (ADR 0026); it knows only that it is done with the context.
    if (result instanceof Promise) {
        return result.finally(() => {
            releaseScope(context)
            watchForLeakedRetain(context)
        }) as Promise<T>
    }
    releaseScope(context)
    watchForLeakedRetain(context)
    return result
}

// How long a context may legitimately outlive its handler before an outstanding retain looks like a bug
// rather than a slow stream. Generous: a long-poll `{#for await}` is bounded by its RPC timeout, not by
// this.
const RETAIN_WARN_MS = 60_000

// Dev-only leak detector for the retain/release refcount (ADR 0026). An unmatched retain is SILENT
// otherwise — the context is simply never disposed, so its per-request memo slots keep effect
// subscriptions alive on module-level `state` and the process climbs. That is the exact failure
// `disposers` exists to prevent, so it should be loud in dev rather than found in production memory.
//
// Unref'd: this timer must never hold the process open (it would break `abide run` and any short-lived
// script). Armed only when the handler finished while someone else still held the context, which for a
// non-streaming request is never.
function watchForLeakedRetain(context: ReactiveScope): void {
    if (Bun.env.NODE_ENV === 'production') return
    if ((context.retains ?? 0) <= 0) return
    const timer = setTimeout(() => {
        if ((context.retains ?? 0) > 0) {
            log.channel('abide:ssr').warn(
                `a request scope is still retained ${RETAIN_WARN_MS}ms after its handler returned ` +
                    `(retains=${context.retains}) — a retainScope() without a matching releaseScope() ` +
                    `leaks its effect subscriptions onto module state`,
            )
        }
    }, RETAIN_WARN_MS)
    timer.unref?.()
}

// The active request scope — but ONLY while the active reactive scope is still the one it was
// entered with (ADR 0026).
//
// This is the fail-closed lever for `shared` memos (rpc-core §2), and it is now STRUCTURAL rather than
// maintained by entering and exiting two things in lockstep. A shared handler runs under
// `exitScope`, which swaps the active context for the neutral default; its `slots` Map is a
// different Map, so the identity below fails and every request-scope accessor —
// identity()/cookies()/request()/context() — throws. The read rejects and the value is never cached,
// in dev AND prod. There is no longer a `runOutsideScope` to forget to call.
//
// The `undefined` short-circuit matters: it answers "no scope" without calling `reactiveScope()`, which
// would install the process-global default scope as a side effect of a read-only question.
export function currentScope(): RequestScope | undefined {
    const scope = scopeStorage.getStore()
    if (scope === undefined) return undefined
    return scope.slots === reactiveScope().slots ? scope : undefined
}
