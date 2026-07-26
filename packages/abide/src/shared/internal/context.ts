// Ambient CACHE CONTEXT — rpc-core §2 (cache scope, the security-critical decision).
//
// Holds a per-scope read cache. Scope differs by side:
//   - Server (Bun): per-request via AsyncLocalStorage (node:async_hooks). Never leaks
//     across requests — a process-global read cache would render one user's data for
//     another (forbidden).
//   - Client (browser): a single module-level singleton (one cache per tab/session).
//
// getContext() with no active ambient context lazily creates and installs a default
// context (bare script / cron / background task) rather than throwing — it still works,
// just without per-request isolation.

import { AsyncLocalStorage } from 'node:async_hooks'
import { isBrowser } from './isBrowser.ts'
// Type-only (erased): the effect-owner scope reactive.ts pushes onto this context. Runtime direction
// stays one-way — reactive.ts imports `getContext` from here, never the reverse.
import type { EffectScope } from './reactive.ts'
import type { RouteInfo } from './routeInfo.ts'

export interface MemoContext {
    slots: Map<string, unknown>
    // ADR 0026. The three per-request facts `shared/` needs, which used to be reached by importing UP
    // into `server/internal/scope.ts`. All three have EXACTLY this context's lifetime, which is the
    // admission rule for living here; `RequestScope`'s five Bun/HTTP fields (request, cookies,
    // identity, bag, server) have the same lifetime but no shared reader, so they stay in `server/`.
    //
    // `requestScoped` is set ONLY by `runInScope`, so it is structurally false on the client and in the
    // server default context — which is why the memo's shared-slot branches no longer need an
    // `isBrowser` guard alongside it.
    requestScoped?: boolean | undefined
    route?: RouteInfo | undefined
    // W3C Trace Context (CO2.3). Seeded by the router from an incoming `traceparent` header, else
    // generated lazily by the first `trace()` call and cached here for the request's lifetime. The
    // router's `finalize` reads it back from here to stamp `traceparent`/`traceresponse`.
    traceparent?: string | undefined
    // True for the whole lifetime of a page-render request (set by `renderPage`, never cleared — the
    // request context is discarded after). A socket's `[Symbol.asyncIterator]` consults this: inside a
    // render it resolves to snapshot-then-complete (client-sockets.md CS5), so iterating a live topic
    // can't hang the render; an RPC/socket-transport/background request leaves it false → live subscribe.
    rendering?: boolean | undefined
    // Open EFFECT-OWNER scopes (reactive.ts), innermost last. Per-context rather than per-process
    // because a server `render` is async: with one process-wide stack, a setup preamble that awaits
    // would resume with another request's scope on top and hand it that request's effects.
    effectScopes?: EffectScope[] | undefined
    // Teardown for reactive nodes whose lifetime is this context's. A per-request slot that takes `memo`'s
    // AUTO-TRACKED fill path (ADR 0024 §2) owns a `computed` subscribed to whatever the body reads — often
    // a MODULE-level `state`, which outlives the request. Without teardown each request would leave a dead
    // observer on that module state forever: unbounded memory, and O(requests) work on every write.
    disposers?: (() => void)[] | undefined
    // Outstanding holds on this context's lifetime (ADR 0026). Absent means the implicit single hold
    // taken by whoever entered it. See `retainContext`/`releaseContext`.
    retains?: number | undefined
}

export function createContext(): MemoContext {
    return { slots: new Map<string, unknown>() }
}

// Register teardown for a node whose lifetime is the ACTIVE context's. No-op bookkeeping on a long-lived
// context (the client singleton / the server default), whose slots are long-lived too — the caller decides
// whether a slot is request-scoped.
export function onContextDispose(dispose: () => void): void {
    const context = getContext()
    if (context.disposers === undefined) context.disposers = [dispose]
    else context.disposers.push(dispose)
}

// Tear down everything registered on `context`, once. Called when a request's work is finished — after the
// response for a buffered reply, after the streamed drain for a streaming one.
export function disposeContext(context: MemoContext): void {
    const disposers = context.disposers
    if (disposers === undefined) return
    context.disposers = undefined
    for (const dispose of disposers) dispose()
}

// RETAIN / RELEASE (ADR 0026). A request's context normally dies when its handler returns, but a
// STREAMED reply is still producing bytes off the response body at that point, so its slots and effects
// must outlive the handler.
//
// This used to be spelled `if (context.stream === undefined) disposeContext(context)` in `runInScope` —
// the primitive's teardown branching on a RENDER field, which is the coupling ADR 0026 exists to
// remove. A refcount says the same thing without naming streaming: the context lives while anyone still
// needs it. Whoever extends its life takes a retain and releases in a `finally`.
export function retainContext(context: MemoContext): void {
    context.retains = (context.retains ?? 1) + 1
}

// Release one hold; dispose at zero. Idempotent past zero — a double release cannot re-run disposers,
// because `disposeContext` clears the list.
export function releaseContext(context: MemoContext): void {
    const remaining = (context.retains ?? 1) - 1
    context.retains = remaining
    if (remaining <= 0) disposeContext(context)
}

// Client-side single module-level cache (one per tab/session). Lazily created.
let clientContext: MemoContext | undefined

// Server-side per-request storage. The stored value is the active context for the
// current async execution scope.
const requestStorage: AsyncLocalStorage<MemoContext> | undefined = isBrowser
    ? undefined
    : new AsyncLocalStorage<MemoContext>()

// Server-side default fallback for calls made with no active request context (bare
// scripts, cron, background tasks). Lazily created and reused so it stays stable.
let defaultContext: MemoContext | undefined

export function getContext(): MemoContext {
    if (isBrowser) {
        if (clientContext === undefined) {
            clientContext = createContext()
        }
        return clientContext
    }

    // Non-browser path: requestStorage is always constructed (only undefined in the browser branch above).
    if (requestStorage === undefined)
        throw new Error('requestStorage is unavailable outside the browser')
    const active = requestStorage.getStore()
    if (active !== undefined) {
        return active
    }

    if (defaultContext === undefined) {
        defaultContext = createContext()
    }
    return defaultContext
}

// The active context WITHOUT the lazy default-context creation `getContext()` performs (ADR 0026).
// `route()`/`trace()` ask "is there a request context?" on paths that may run with none at all (a bare
// script, a cron tick), and answering a read-only question should not install a process-global default
// context as a side effect. Returns the client singleton only if something already created it.
export function peekContext(): MemoContext | undefined {
    if (isBrowser) return clientContext
    return requestStorage?.getStore()
}

// The persistent server default context, or undefined on the client / before it is created. Used by
// the memo primitive to recognise (and LRU-bound) the ambient default context's slot store.
export function serverDefaultContext(): MemoContext | undefined {
    return defaultContext
}

// Run fn with NO active cache context so getContext() falls back to the server default context.
// The server-side half of scope isolation for `shared` memos: while a shared handler runs
// scope-exited, a nested non-shared memo must land in the neutral default context, never a
// request's Map. On the client (no async isolation) this is a plain call.
export function runOutsideContext<T>(fn: () => T): T {
    if (isBrowser || requestStorage === undefined) return fn()
    return requestStorage.exit(fn)
}

export function runInContext<T>(ctx: MemoContext, fn: () => T): T {
    if (isBrowser || requestStorage === undefined) {
        // No async-scoped isolation on the client. Swap the singleton for the duration of
        // the call and restore on exit so nested calls behave like the server.
        const previous = clientContext
        clientContext = ctx
        try {
            return fn()
        } finally {
            clientContext = previous
        }
    }

    return requestStorage.run(ctx, fn)
}
