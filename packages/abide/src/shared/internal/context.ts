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

// The per-render streaming-SSR scratchpad (streaming-ssr-plan.md, PR2). Present only while an SSR page
// render is streaming; a streaming-form read (`{#await}` block) that hasn't settled by the deadline
// registers a deferred subtree here, which the document stream drains into out-of-order patches. The
// scheduler LOGIC lives in `ui/internal/streamScope.ts`; this is just the per-request carrier (like
// `states`), kept here so `getContext()` reaches it from the emitted `render` without new plumbing.
export interface StreamScope {
    // Resolves (to a sentinel) after the SSR deadline (default 4ms). A `{#await}` read (or the initial
    // `{#for await}` items) that settles before it renders inline (warm/fast pages stay byte-identical);
    // work still pending after it is deferred + streamed as a patch.
    deadlinePassed: Promise<symbol>
    // LAZILY-ARMED last-resort `{#for await}` streaming budget (default 5min, `ABIDE_SSR_STREAM_BUDGET`).
    // Consulted ONLY by a NON-abide source (raw generator / `fetch().body`), which is cut off when it
    // fires (client re-iterates) — this is why an unbounded SSR `{#for await}` never hangs the body. An
    // abide RPC source is bounded by its own bilateral timeout and NEVER calls this (§6), so a page whose
    // streaming sources are all abide RPCs never schedules the timer. Memoized: one timer per render, max.
    budget: () => Promise<symbol>
    deferred: DeferredSubtree[]
    streamers: DeferredStreamer[]
    // Handoff records for attachable `{#for await}` sources (replayable-streams.md §5). One per
    // ATTACHABLE (known-RPC) streamed list, keyed by `listId` (its `<abide-list>` id). `collectSeed`
    // drains these into the seed's `streams` section so the client ADOPTS the decoded transcript (mode
    // A, `done`) or RESUMES over `?__abide_from=<count>` (mode B, open) instead of re-invoking the source. A
    // streamer mutates its own record's `count`/`values`/`done` as it flushes; the record is final by
    // the time `collectSeed` runs (after the drain). Non-attachable sources register nothing.
    streamHandles: StreamHandleRecord[]
    nextId: number
}

// A per-render, mutable record backing one attachable `{#for await}` handoff. `name` is the source's
// RPC route name (null when the source is attachable-tagged but ran without one — defensive; a null
// name is inline-adopt-only, never resumed). `values` is the append-only decoded transcript captured
// during SSR; `count` = `values.length` at flush; `done` flips true when the source closed normally.
export interface StreamHandleRecord {
    listId: string
    name: string | null
    args: unknown
    done: boolean
    count: number
    values: unknown[]
}

export interface DeferredSubtree {
    id: number
    // Render the resolved subtree HTML (then/catch branch + finally). `null` when the subtree's read
    // errored with no `{:catch}` — the drain emits an empty patch that clears the placeholder (PR5).
    render: () => Promise<{ html: string } | null>
}

// A streamed `{#for await}` (PR6): a multi-yield deferred that appends rendered items to its
// `<abide-list>` container as the source yields them, then a `complete` frame iff the source ended
// within the budget (the client then claims the items rather than re-iterating).
export interface DeferredStreamer {
    id: number
    run: () => AsyncGenerator<StreamFrame>
}

export type StreamFrame = { op: 'append'; html: string } | { op: 'complete' }

export interface MemoContext {
    slots: Map<string, unknown>
    // Per-request ordered recorder of `state(initial)` initial values, pushed in call order during
    // SSR (§5 state-initializer record/replay). `collectSeed` drains it into the hydration seed so the
    // client replays each cell's server-computed initial by ordinal instead of re-evaluating it. Grouped
    // into per-component buckets (one array per component instance, mount order) so a component's
    // `state()`-sequence divergence stays contained to its bucket rather than shifting later components.
    states: unknown[][]
    // Set while an SSR page render is streaming (undefined otherwise / on the client).
    stream?: StreamScope | undefined
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
}

export function createContext(): MemoContext {
    return { slots: new Map<string, unknown>(), states: [] }
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
