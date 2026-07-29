// SERVER REQUEST SCOPE — rpc-core §M2. The per-request ambient bundle that server-side
// accessors (request/cookies/server/context/identity/route) read from.
//
// Named `requestScope.ts` to pair with `shared/internal/reactiveScope.ts` (ADR 0026): two scopes with
// the SAME lifetime and different content — this one holds what the web asked (a `Request`, cookies,
// identity, the Bun server), that one holds what the framework computed (memo slots, effects). A bare
// `scope.ts` gave no hint which of the two you were importing.
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
import { anonymousPrincipal } from '../../shared/internal/anonymousPrincipal.ts'
import type { Principal } from '../../shared/internal/principal.ts'
import {
    enterScope,
    type ReactiveScope,
    reactiveScope,
    releaseScope,
} from '../../shared/internal/reactiveScope.ts'
import type { RouteInfo, RouteKind } from '../../shared/internal/routeInfo.ts'
import { log } from '../../shared/log.ts'
import { identityWriter } from './identityWriter.ts'
import { isProd } from './isProd.ts'

// `RouteInfo`/`RouteKind` moved to `shared/internal/` (ADR 0026) so `shared/route.ts` can name the type
// it returns without importing up. Re-exported here because every server + ui importer already reaches
// them through this module.
export type { Principal, RouteInfo, RouteKind }
export { anonymousPrincipal }

export interface RequestScope {
    request: Request
    cookies: Bun.CookieMap
    // WHO this request is acting as, resolved by the bearer/cookie ladder before any handler runs.
    // Set at construction and thereafter written ONLY by the identity writer, which updates this and
    // the reactive scope's copy together — the reactive one is what `shared/identity.ts` reads (it is
    // isomorphic and cannot import this module), this one is what the router seals into the cookie.
    // One writer, so the two cannot drift; same arrangement `traceparent` has.
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
    // Explicitly `| undefined` for the same reason `traceparent` is: every construction site SETS the
    // key, so the scope object is built in one shape.
    server?: Bun.Server<undefined> | undefined
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

// THE ONE CONSTRUCTION SITE for a request scope.
//
// There are two callers and they had drifted. The router set every field — its comment records that
// even `traceparent` is set to `undefined` explicitly "so the scope object is built in one shape" —
// while `channelAuth.reauthorize`, which rebuilds the scope a normal request would have run in so it
// can re-run the SAME middleware chain, omitted `server`, `traceparent`, and the four identity flags.
// Every one of them is optional on the interface, so nothing caught it.
//
// That mattered because `reauthorize` FAILS CLOSED on any throw. A global middleware calling
// `server()` throws "no Bun server bound to the current request scope" there and silently denies
// every `@rpc:` cache-channel join and every roomed socket subscribe — reported only on the
// DEBUG-gated `abide:socket` channel. Same middleware, same identity, different verdict depending on
// which door the caller came through, which is the one thing that module exists to prevent.
//
// Taking the parts as REQUIRED arguments is the enforcement: a second caller cannot omit a field by
// not mentioning it, and a new field is a compile error at both sites rather than an `undefined` at
// one of them.
export function makeRequestScope(parts: {
    request: Request
    cookies: Bun.CookieMap
    identity: Principal
    route: RouteInfo
    server: Bun.Server<undefined> | undefined
    traceparent: string | undefined
    identityStateless: boolean
    identityExpiresAt: number | undefined
}): RequestScope {
    return {
        request: parts.request,
        cookies: parts.cookies,
        identity: parts.identity,
        identityStateless: parts.identityStateless,
        identityCleared: false,
        identityDirty: false,
        identityExpiresAt: parts.identityExpiresAt,
        bag: {},
        route: parts.route,
        server: parts.server,
        slots: new Map<string, unknown>(),
        traceparent: parts.traceparent,
    }
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
        identity: scope.identity,
    }
    // The write half of the isomorphic `identity()`: installed here because only the server can seal a
    // cookie, and ABSENT on the client for the same reason — which is what turns a browser
    // `identity.set()` into a specific error instead of a silent no-op.
    context.identityWrite = identityWriter(scope, context)
    const result = scopeStorage.run(scope, () =>
        enterScope(context, () => {
            // The fail-closed guarantee now RESTS on this identity (see `currentScope`), where it used
            // to rest on a comment. If a future edit builds the context with its own Map, every
            // request-scope accessor silently starts throwing inside a live request — a failure that
            // would surface as an unexplained 500 far from here. Assert it once, at entry, in dev.
            if (!isProd() && scope.slots !== reactiveScope().slots) {
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
// rather than a slow stream. Generous: a long-poll `{#for await}` is bounded by its rpc's run deadline
// (ADR 0028), not by this — and since that deadline is a PROGRESS clock, a stream that keeps flowing
// legitimately outlives this window. Hence a warning rather than a teardown.
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
    if (isProd()) return
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
