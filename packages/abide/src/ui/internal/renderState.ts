// PER-RENDER STATE — everything an SSR page render accumulates that is NOT the memo primitive's
// business (ADR 0026).
//
// These five interfaces used to live on `ReactiveScope`, so the primitive that should know only "here is
// a Map of slots" also declared `<abide-list>` handoff ids, RPC route names, hydration-seed buckets and
// out-of-order patch ops. The reason was structural rather than lazy: `emitServer` generates
// `async render()` with NO ambient parameter, so a per-render fact must be reachable from a global
// accessor, and the memo context was the only ambient that existed.
//
// It is no longer the only one. This module keys its own state off the reactive scope by identity, so
// `ui/` owns the types outright and the lookup still needs no plumbing through emitted code. A WeakMap
// rather than a second AsyncLocalStorage: the entry dies with the context, there is nothing to enter or
// exit, and no per-request ALS cost.
//
// Layering: `ui -> shared` (35 existing imports) and `server -> ui` (9, incl. `pages.ts` importing
// `streamScheduler.ts`) are both established directions, so nothing here inverts the graph.

import {
    peekReactiveScope,
    type ReactiveScope,
    reactiveScope,
} from '../../shared/internal/reactiveScope.ts'

// The streaming-SSR scratchpad (streaming-ssr-plan.md, PR2). Present only while a render is STREAMING;
// a streaming-form read (`{#await}` block) that hasn't settled by the deadline registers a deferred
// subtree here, which the document stream drains into out-of-order patches. The scheduler LOGIC lives
// in `streamScheduler.ts`; this is the carrier.
export interface RenderStream {
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

export interface RenderState {
    // Recorder of `state(initial)` initial values seen during SSR (§5 state-initializer record/replay).
    // `collectSeed` drains it into the hydration seed so the client replays each cell's server-computed
    // initial instead of re-evaluating it. Bucketed BY SITE PATH (the component's stable per-module site
    // id, plus the item index inside a loop) rather than by mount order — so a component's
    // `state()`-sequence divergence stays contained to its bucket, and its bucket cannot shift when a
    // sibling region mounts asynchronously on one side only. Built by `pages.makeRecordingState`,
    // replayed by `seededState`.
    states: Record<string, unknown[]>
    // Set only while this render is streaming.
    stream?: RenderStream | undefined
}

const RENDER = new WeakMap<ReactiveScope, RenderState>()

// Open a render's state on the active context, replacing any previous one. Called once per page render.
export function openRenderState(): RenderState {
    const state: RenderState = { states: {} }
    RENDER.set(reactiveScope(), state)
    return state
}

// The active render's state, or undefined outside a render. `peekReactiveScope` so asking the question never
// installs the process-global default scope.
export function renderState(): RenderState | undefined {
    const context = peekReactiveScope()
    return context === undefined ? undefined : RENDER.get(context)
}

// Drop the render's state. A per-render scratchpad must never leak deferreds onto a reused context.
export function closeRenderState(): void {
    const context = peekReactiveScope()
    if (context !== undefined) RENDER.delete(context)
}

// Run `fn` with this render's STREAMING state suppressed, restoring it afterwards.
//
// The one real caller is a benchmark that times many nested renders inside one page render: without
// this each timed render would defer its subtrees into the PAGE's stream (hundreds of stray patches),
// so it needs the emitted render to take its no-stream buffered path. It used to save/restore
// `context.stream` by hand from app code; this is the same operation with a name and an owner.
export function withoutRenderStream<T>(fn: () => T): T {
    const state = renderState()
    if (state === undefined) return fn()
    const saved = state.stream
    state.stream = undefined
    try {
        return fn()
    } finally {
        state.stream = saved
    }
}
