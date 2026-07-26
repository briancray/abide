// THE REACTIVE SCOPE — one box per unit of work, holding everything reactive that belongs to that
// unit so none of it leaks into another. A unit of work is ONE REQUEST on the server, ONE TAB on the
// client. rpc-core §2 (the security-critical decision).
//
// WHY IT EXISTS: the memo cache. A process-global read cache would render one user's data for another
// (forbidden), so the cache lives in a box that dies with the request.
//
// WHY IT IS AMBIENT rather than a parameter: the code that calls `memo()`/`state()` is your handler
// code and AOT-emitted template code, and neither can be handed a hidden argument. So it is fetched
// from a global accessor.
//   - Server (Bun): per-request via AsyncLocalStorage (node:async_hooks).
//   - Client (browser): a single module-level singleton.
//
// LIFECYCLE: the router makes one (`runInScope`) -> everything running in that request finds the same
// one -> it is released and disposed, taking its cached values and effect teardowns with it. See
// `retainScope`/`releaseScope` for the one case that outlives the handler.
//
// NAMED A SCOPE, NOT A CONTEXT (ADR 0026). It is entered, exited, nested and disposed — that is a
// dynamic extent, which is what "scope" means here; "scope" means ambient facts with no lifecycle,
// which is the opposite of its defining property. It was `MemoContext`, which was wrong on both halves:
// "memo" was accurate when it held only `slots` and it now holds six things, and "scope" collided
// with the PUBLIC `scope()` accessor (`server/scope.ts`), which returns the per-request bag —
// something else entirely.
//
// `reactiveScope()` with no active scope lazily creates and installs a process-global default (bare
// script / cron / background task) rather than throwing — it still works, just without per-request
// isolation. Use `peekReactiveScope()` when the absence is itself a valid answer.

import { AsyncLocalStorage } from 'node:async_hooks'
import { isBrowser } from './isBrowser.ts'
// Type-only (erased): the effect-owner scope reactive.ts pushes onto this scope. Runtime direction
// stays one-way — reactive.ts imports `reactiveScope` from here, never the reverse.
import type { EffectScope } from './reactive.ts'
import type { RouteInfo } from './routeInfo.ts'

export interface ReactiveScope {
    slots: Map<string, unknown>
    // ADR 0026. The three per-request facts `shared/` needs, which used to be reached by importing UP
    // into `server/internal/requestScope.ts`. All three have EXACTLY this scope’s lifetime, which is the
    // admission rule for living here; `RequestScope`'s five Bun/HTTP fields (request, cookies,
    // identity, bag, server) have the same lifetime but no shared reader, so they stay in `server/`.
    //
    // `requestScoped` is set ONLY by `runInScope`, so it is structurally false on the client and in the
    // server default scope — which is why the memo's shared-slot branches no longer need an
    // `isBrowser` guard alongside it.
    requestScoped?: boolean | undefined
    route?: RouteInfo | undefined
    // W3C Trace Context (CO2.3). Seeded by the router from an incoming `traceparent` header, else
    // generated lazily by the first `trace()` call and cached here for the request's lifetime. The
    // router's `finalize` reads it back from here to stamp `traceparent`/`traceresponse`.
    traceparent?: string | undefined
    // True for the whole lifetime of a page-render request (set by `renderPage`, never cleared — the
    // request scope is discarded after). A socket's `[Symbol.asyncIterator]` consults this: inside a
    // render it resolves to snapshot-then-complete (client-sockets.md CS5), so iterating a live topic
    // can't hang the render; an RPC/socket-transport/background request leaves it false → live subscribe.
    rendering?: boolean | undefined
    // Open EFFECT-OWNER scopes (reactive.ts), innermost last. Per-scope rather than per-process
    // because a server `render` is async: with one process-wide stack, a setup preamble that awaits
    // would resume with another request's scope on top and hand it that request's effects.
    effectScopes?: EffectScope[] | undefined
    // Teardown for reactive nodes whose lifetime is this scope's. A per-request slot that takes `memo`'s
    // AUTO-TRACKED fill path (ADR 0024 §2) owns a `computed` subscribed to whatever the body reads — often
    // a MODULE-level `state`, which outlives the request. Without teardown each request would leave a dead
    // observer on that module state forever: unbounded memory, and O(requests) work on every write.
    disposers?: (() => void)[] | undefined
    // Outstanding holds on this scope’s lifetime (ADR 0026). Absent means the implicit single hold
    // taken by whoever entered it. See `retainScope`/`releaseScope`.
    retains?: number | undefined
}

export function createReactiveScope(): ReactiveScope {
    return { slots: new Map<string, unknown>() }
}

// Register teardown for a node whose lifetime is the ACTIVE scope. No-op bookkeeping on a long-lived
// scope (the client singleton / the server default), whose slots are long-lived too — the caller decides
// whether a slot is request-scoped.
export function onScopeDispose(dispose: () => void): void {
    const scope = reactiveScope()
    if (scope.disposers === undefined) scope.disposers = [dispose]
    else scope.disposers.push(dispose)
}

// Tear down everything registered on `scope`, once. Called when a request's work is finished — after the
// response for a buffered reply, after the streamed drain for a streaming one.
export function disposeScope(scope: ReactiveScope): void {
    const disposers = scope.disposers
    if (disposers === undefined) return
    scope.disposers = undefined
    for (const dispose of disposers) dispose()
}

// RETAIN / RELEASE (ADR 0026). A request's scope normally dies when its handler returns, but a
// STREAMED reply is still producing bytes off the response body at that point, so its slots and effects
// must outlive the handler.
//
// This used to be spelled `if (scope.stream === undefined) disposeScope(scope)` in `runInScope` —
// the primitive's teardown branching on a RENDER field, which is the coupling ADR 0026 exists to
// remove. A refcount says the same thing without naming streaming: the scope lives while anyone still
// needs it. Whoever extends its life takes a retain and releases in a `finally`.
export function retainScope(scope: ReactiveScope): void {
    scope.retains = (scope.retains ?? 1) + 1
}

// Release one hold; dispose at zero. Idempotent past zero — a double release cannot re-run disposers,
// because `disposeScope` clears the list.
export function releaseScope(scope: ReactiveScope): void {
    const remaining = (scope.retains ?? 1) - 1
    scope.retains = remaining
    if (remaining <= 0) disposeScope(scope)
}

// Client-side single module-level cache (one per tab/session). Lazily created.
let clientScope: ReactiveScope | undefined

// Server-side per-request storage. The stored value is the active scope for the
// current async execution scope.
const requestStorage: AsyncLocalStorage<ReactiveScope> | undefined = isBrowser
    ? undefined
    : new AsyncLocalStorage<ReactiveScope>()

// Server-side default fallback for calls made with no active request scope (bare
// scripts, cron, background tasks). Lazily created and reused so it stays stable.
let defaultScope: ReactiveScope | undefined

export function reactiveScope(): ReactiveScope {
    if (isBrowser) {
        if (clientScope === undefined) {
            clientScope = createReactiveScope()
        }
        return clientScope
    }

    // Non-browser path: requestStorage is always constructed (only undefined in the browser branch above).
    if (requestStorage === undefined)
        throw new Error('requestStorage is unavailable outside the browser')
    const active = requestStorage.getStore()
    if (active !== undefined) {
        return active
    }

    if (defaultScope === undefined) {
        defaultScope = createReactiveScope()
    }
    return defaultScope
}

// The active scope WITHOUT the lazy default-scope creation `reactiveScope()` performs (ADR 0026).
// `route()`/`trace()` ask "is there a request scope?" on paths that may run with none at all (a bare
// script, a cron tick), and answering a read-only question should not install a process-global default
// scope as a side effect. Returns the client singleton only if something already created it.
export function peekReactiveScope(): ReactiveScope | undefined {
    if (isBrowser) return clientScope
    return requestStorage?.getStore()
}

// The persistent server default scope, or undefined on the client / before it is created. Used by
// the memo primitive to recognise (and LRU-bound) the ambient default scope's slot store.
export function serverDefaultScope(): ReactiveScope | undefined {
    return defaultScope
}

// Run fn with NO active reactive scope so reactiveScope() falls back to the server default scope.
// The server-side half of scope isolation for `shared` memos: while a shared handler runs
// scope-exited, a nested non-shared memo must land in the neutral default scope, never a
// request's Map. On the client (no async isolation) this is a plain call.
export function exitScope<T>(fn: () => T): T {
    if (isBrowser || requestStorage === undefined) return fn()
    return requestStorage.exit(fn)
}

export function enterScope<T>(scope: ReactiveScope, fn: () => T): T {
    if (isBrowser || requestStorage === undefined) {
        // No async-scoped isolation on the client. Swap the singleton for the duration of
        // the call and restore on exit so nested calls behave like the server.
        const previous = clientScope
        clientScope = scope
        try {
            return fn()
        } finally {
            clientScope = previous
        }
    }

    return requestStorage.run(scope, fn)
}
