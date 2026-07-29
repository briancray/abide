// STREAMING SSR — per-render deferred-subtree scheduler (streaming-ssr-plan.md, PR2). BUILD/SSR-SIDE.
//
// This is the LOGIC over a `RenderStream`; the state itself lives on the render state
// (`renderState.ts`). The file was `streamScope.ts`, named for a `StreamScope` type that no longer
// exists — it was never an extent you enter and leave, and ADR 0026 renamed it `RenderStream` and moved
// it next to the rest of the per-render state. A scheduler is what this file actually is.
//
// The emitted server `render` calls `awaitStream(...)` for every STREAMING-form `{#await}` block. Each
// read is raced against ONE per-render deadline (`createRenderStream`): a read that settles first
// renders inline (byte-identical to the blocking path — warm/fast pages are unchanged); a read still
// pending when the deadline passes is DEFERRED — the render emits a sentinel-bracketed placeholder now and
// registers a subtree renderer, which the document stream (`drainPatches`) flushes later as an
// out-of-order `<template>` + move-script patch. Blocking forms (`{await fn()}`, `{#await p then v}`)
// never call this — they await inline as before.

import { envMs } from '../../shared/internal/envMs.ts'
import { markIterableDone } from '../../shared/internal/iterableDone.ts'
import { log } from '../../shared/log.ts'
import type {
    DeferredStreamer,
    DeferredSubtree,
    RenderStream,
    StreamFrame,
    StreamHandleRecord,
} from './renderState.ts'
import { renderState } from './renderState.ts'
import { STREAM_SENTINEL } from './STREAM_SENTINEL.ts'
import { abideAppendItem, abideFillSlot } from './streamPatchDom.ts'

// The race sentinel the deadline resolves to. Identity-compared, so it can never collide with a read
// value (a read resolving to this exact symbol is impossible — it is module-private).
const DEADLINE_PASSED: unique symbol = Symbol('abide.ssr.deadline')
// The race sentinel the `{#for await}` streaming budget resolves to.
const BUDGET_PASSED: unique symbol = Symbol('abide.ssr.budget')

// The SSR streaming deadline in ms (default 4; override with `ABIDE_SSR_DEADLINE`). A read that settles
// within it renders inline; one still pending after it is streamed as a patch. It is time-based, NOT a
// single macrotask: an SSR read is ALWAYS cold-cache (fresh per-request Map) and crosses ≥1 macrotask,
// and the deadline timer is scheduled at render start (before the read kicks), so a `setTimeout(0)`
// deadline would fire first and stream EVERY read. 4ms cleanly separates a cold-but-fast in-proc read
// (~0.1ms) from genuine I/O (network/disk, ms+) with wide margin on both sides, so the inline/stream
// classification is stable across machines (fast/warm pages stay byte-identical to the buffered path).

// A timer promise resolving to `sentinel` after `ms`, unref'd so it never by itself holds the process.
function timerPromise(ms: number, sentinel: symbol): Promise<symbol> {
    let settle: (value: symbol) => void
    const promise = new Promise<symbol>((resolve) => {
        settle = resolve
    })
    const timer = setTimeout(() => settle(sentinel), ms) as unknown as { unref?: () => void }
    timer.unref?.()
    return promise
}

// Create the per-render streaming scope with its deadline (default 4ms, `ABIDE_SSR_DEADLINE`) and the
// `{#for await}` streaming budget (default 5min, `ABIDE_SSR_STREAM_BUDGET`) — a LAST-RESORT bound past
// which a still-running streamed list is cut off (client re-iterates) so an SSR `{#for await}` never
// hangs. It applies ONLY to NON-abide sources (raw generators / `fetch().body`); an abide RPC source
// carries its OWN progress deadline (ADR 0028 D1) and gets no global cap at all
// (replayable-streams.md §6).
export function createRenderStream(): RenderStream {
    let budgetPromise: Promise<symbol> | undefined
    return {
        deadlinePassed: timerPromise(envMs('ABIDE_SSR_DEADLINE', 4), DEADLINE_PASSED),
        // Armed on first call, memoized — so an all-abide-source page never schedules the 5-min timer.
        budget: () =>
            (budgetPromise ??= timerPromise(
                envMs('ABIDE_SSR_STREAM_BUDGET', 300_000),
                BUDGET_PASSED,
            )),
        deferred: [],
        streamers: [],
        streamHandles: [],
        nextId: 0,
    }
}

// The renderer thunks the emitter builds for one `{#await}` block. `resolved` renders the then-branch
// (or the pending branch when the block has no `then`); `pending` renders the fallback shown in the
// placeholder slot; `caught` renders the catch-branch (null → rethrow); `finalize` renders `{:finally}`
// (null → none), appended after the settled branch (never shown during pending).
export interface AwaitStreamConfig {
    read: () => unknown
    resolved: (value: unknown) => Promise<string>
    pending: () => Promise<string>
    caught: ((error: unknown) => Promise<string>) | null
    finalize: (() => Promise<string>) | null
}

// Resolve the read and render its settled branch (then/catch) + finally. Shared by the inline-fast path
// and the deferred path — they differ only in WHEN this runs, never in WHAT it produces. A throw from
// the then-render is routed to `caught` exactly as the blocking emitter's try/catch did.
async function settle(read: Promise<unknown>, config: AwaitStreamConfig): Promise<string> {
    let html: string
    try {
        html = await config.resolved(await read)
    } catch (error) {
        if (config.caught === null) throw error
        html = await config.caught(error)
    }
    if (config.finalize !== null) html += await config.finalize()
    return html
}

// The one entry the emitted streaming `{#await}` calls. Returns the HTML to splice at the block's
// position — the resolved branch (fast) or a sentinel-bracketed fallback (deferred).
export async function awaitStream(config: AwaitStreamConfig): Promise<string> {
    const read = Promise.resolve(config.read())
    const scope = renderState()?.stream
    // No streaming scope (a direct `render()` in tests / non-page SSR) → behave like the blocking
    // emitter: await fully, render inline. Keeps those outputs byte-identical to the pre-streaming path.
    if (scope === undefined) return await settle(read, config)

    // Race the read against the single per-render deadline. `read.then(noop, noop)` marks the read handled
    // (no unhandled-rejection) while we only observe WHICH settled first.
    const outcome = await Promise.race<symbol | undefined>([
        read.then(
            () => undefined,
            () => undefined,
        ),
        scope.deadlinePassed,
    ])
    if (outcome !== DEADLINE_PASSED) return await settle(read, config) // settled in time → inline.

    // Pending past the deadline → placeholder now, patch later.
    const id = scope.nextId++
    scope.deferred.push({
        id,
        render: async () => {
            // A read that errors WITH a `{:catch}` renders that branch inside `settle` (the graceful path — it
            // streams as the patch like any resolved subtree). A read that errors WITHOUT a `{:catch}` can no
            // longer 500 (headers already flushed at the shell), so `settle` rethrows here (PR5): CLEAR the
            // slot to empty rather than leaving a stuck "loading…" fallback forever, and log loudly. We do NOT
            // abort the whole stream — that would kill sibling patches + the rest of the page for one failed
            // subtree; a bounded, logged, empty subtree is the graceful degradation (authors add `{:catch}`
            // for real error UI).
            try {
                return { html: await settle(read, config) }
            } catch (error) {
                log.channel('abide:stream').error(
                    'streamed {#await} subtree threw with no {:catch} — cleared the slot:',
                    error,
                )
                return { html: '' }
            }
        },
    })
    // SENTINEL-BRACKETED, never wrapped in an element. A wrapper element emitted inside a table section
    // (`<table>`/`<thead>`/`<tbody>`/`<tfoot>`/`<tr>`) is FOSTER-PARENTED by the HTML parser — relocated
    // to just BEFORE the `<table>` — which stranded the placeholder outside the table and left every
    // patch appending into an orphan. A comment and a `<template>` are the only two node kinds EVERY
    // insertion mode inserts in place (`in table` defers `style`/`script`/`template` to the `in head`
    // rules), so this pair brackets correctly in any parent. The `<template>` carries the id (the patch
    // script's O(1) `getElementById` handle); the comment marks where the fallback region starts.
    // Hydration removes both sentinels (PR3, `runtime.unwrapStreamSlot`).
    const pendingId = `${STREAM_SENTINEL.pending}${id}`
    return `<!--${pendingId}-->${await config.pending()}<template id="${pendingId}"></template>`
}

// Resolve a `{#for await}` source expression to an async iterator (awaiting a promise-of-iterable, and
// adapting a sync iterable), plus the source object itself (for the `done()` probe). Mirrors what a
// native `for await (… of expr)` does.
async function toIterator(
    expr: unknown,
): Promise<{ source: unknown; next: () => Promise<IteratorResult<unknown>> }> {
    const source = await (expr as Promise<unknown>)
    const obj = source as {
        [Symbol.asyncIterator]?: () => AsyncIterator<unknown>
        [Symbol.iterator]?: () => Iterator<unknown>
    } | null
    // Invoke the factory with `.call(obj)` so `this === obj` — an iterable's `[Symbol.asyncIterator]`
    // typically returns `this`, so an unbound call would lose the binding and yield `undefined`.
    const asyncFactory = obj != null ? obj[Symbol.asyncIterator] : undefined
    if (typeof asyncFactory === 'function') {
        const it = asyncFactory.call(obj)
        return { source, next: () => Promise.resolve(it.next()) }
    }
    const syncFactory = obj != null ? obj[Symbol.iterator] : undefined
    if (typeof syncFactory === 'function') {
        const it = syncFactory.call(obj)
        return { source, next: () => Promise.resolve(it.next()) }
    }
    return { source, next: () => Promise.resolve({ value: undefined, done: true }) }
}

export interface ForAwaitStreamConfig {
    source: () => unknown
    renderItem: (value: unknown, index: number) => Promise<string>
    caught: ((error: unknown) => Promise<string>) | null
    // Attach-handoff tag (replayable-streams.md §5), emitted by `emitServer` only when the source head
    // resolves to a known RPC import. `attachable` gates the whole handoff; `rpcName` is the RPC route
    // name (= the source's wire name); `args` re-evaluates the call's argument expression so the handle
    // can be resumed over `?__abide_from=<count>` WITHOUT re-invoking the source on the client. A non-RPC source
    // (bare async generator / `fetch().body`) leaves these unset → today's behavior (client re-iterates).
    attachable?: boolean
    rpcName?: string
    args?: () => unknown
}

// Evaluate an attachable source's argument expression once so the handoff record can be resumed over
// `?__abide_from=<count>` on the client WITHOUT re-invoking the source (§5). Pure by contract; a throw
// degrades to `undefined` (the record stays inline-adopt-only rather than crashing the render).
async function resolveArgs(config: ForAwaitStreamConfig): Promise<unknown> {
    if (config.args === undefined) return undefined
    try {
        return await config.args()
    } catch {
        return undefined
    }
}

// Remove a handoff record (an errored stream has no sound "adopt + surface error" handoff in the first
// build — dropping the record makes the client re-run, matching today's behavior).
function dropHandle(scope: RenderStream, handle: StreamHandleRecord): void {
    const at = scope.streamHandles.indexOf(handle)
    if (at !== -1) scope.streamHandles.splice(at, 1)
}

// The one entry the emitted streaming `{#for await}` calls. Drains the source up to the deadline INLINE
// (a synchronous/fast stream stays byte-identical to the buffered path); if it is still yielding past
// the deadline it returns the items seen so far + a trailing `<template>` sentinel and registers a
// STREAMER that appends each subsequent item as a patch, then marks the list COMPLETE iff the source
// ends. The SSR budget is SOURCE-DERIVED (§6), and the two clocks differ in KIND, not just in who owns
// them: an abide RPC source (`attachable`) carries its own run deadline, which is a PROGRESS clock (ADR
// 0028 D1) — it trips only on an idle gap, so a healthy stream runs for hours and gets NO global SSR
// cap; a NON-abide source (raw generator / `fetch().body`) is cut off at the last-resort global
// `ABIDE_SSR_STREAM_BUDGET` (default 5min), which is TOTAL wall-clock and cuts a perfectly healthy
// stream too. That asymmetry is the exemption's justification. A tripped abide deadline arrives as an
// iteration ERROR (the memo `fail`s the transcript), so it lands in the catch below — `{:catch}`
// rendered, handle dropped, client re-runs — rather than as a silent truncation. For an
// ATTACHABLE (known-RPC) source it ALSO captures the decoded item values
// and registers a `StreamHandleRecord` (§5) so the client ADOPTS the transcript (mode A, completed) or
// RESUMES it (mode B, open) on hydrate instead of re-invoking the RPC — the SSR paint is placeholder
// only. A non-attachable source keeps today's markup byte-for-byte (no sentinel when it drains
// inline; no `data-ab-count`; no handle) and the client re-iterates it.
export async function forAwaitStream(config: ForAwaitStreamConfig): Promise<string> {
    const { source, next } = await toIterator(config.source())
    const scope = renderState()?.stream

    // No streaming scope (direct render / tests) → drain fully inline (byte-identical to today). No seed
    // is produced in this path, so there is nothing to hand off — the client re-iterates.
    if (scope === undefined) {
        let html = ''
        let index = 0
        try {
            for (let step = await next(); step.done !== true; step = await next()) {
                html += await config.renderItem(step.value, index++)
            }
            markIterableDone(source)
            return html
        } catch (error) {
            markIterableDone(source)
            if (config.caught === null) throw error
            return html + (await config.caught(error))
        }
    }

    const attachable = config.attachable === true

    // Drain up to the deadline inline, capturing decoded values for the handoff.
    let html = ''
    const values: unknown[] = []
    let index = 0
    let pending = next()
    for (;;) {
        const raced = await Promise.race([
            pending.then(
                (step) => ({ kind: 'item' as const, step }),
                (error) => ({ kind: 'error' as const, error }),
            ),
            scope.deadlinePassed.then(() => ({ kind: 'deadline' as const })),
        ])
        if (raced.kind === 'deadline') break // still yielding past the deadline → stream the remainder.
        if (raced.kind === 'error') {
            // Errored before the deadline → no handle (client re-runs; today's behavior for a failed stream).
            markIterableDone(source)
            if (config.caught === null) throw raced.error
            return html + (await config.caught(raced.error))
        }
        if (raced.step.done === true) {
            markIterableDone(source) // fully drained before the deadline.
            if (!attachable) return html // non-attachable → no container, byte-identical to today.
            // Completed inline (mode A): tag the paint with the id'd sentinel the client can match, and seed
            // the whole decoded transcript so hydration re-mounts from `values` with zero network.
            const id = scope.nextId++
            const listId = `${STREAM_SENTINEL.list}${id}`
            scope.streamHandles.push({
                name: config.rpcName ?? null,
                args: await resolveArgs(config),
                done: true,
                values,
            })
            return `${html}<template id="${listId}"></template>`
        }
        values.push(raced.step.value)
        html += await config.renderItem(raced.step.value, index++)
        pending = next()
    }

    // Past the deadline with the source still yielding → stream the remainder as append patches.
    const id = scope.nextId++
    const listId = `${STREAM_SENTINEL.list}${id}`
    const startIndex = index
    const inFlight = pending // the in-flight `next()` the deadline raced — the streamer resumes from it.

    // Register the handoff record now (needed synchronously for collectSeed): an attachable source that
    // completes within the budget lands as mode A (done:true, full values); one cut off at the budget
    // stays mode B (done:false, resume from `values.length`). The streamer mutates this record as it
    // flushes — `values` is append-only, and the flushed count is just its length.
    let handle: StreamHandleRecord | null = null
    if (attachable) {
        handle = {
            name: config.rpcName ?? null,
            args: await resolveArgs(config),
            done: false,
            values,
        }
        scope.streamHandles.push(handle)
    }

    scope.streamers.push({
        id,
        run: async function* (): AsyncGenerator<StreamFrame> {
            let i = startIndex
            let step = inFlight
            try {
                for (;;) {
                    // Source-derived budget (§6): an abide RPC source carries its own PROGRESS deadline (ADR
                    // 0028), which self-terminates the stream as an error, so await it directly with no global
                    // cap; a non-abide source races the last-resort total-wall-clock `ABIDE_SSR_STREAM_BUDGET`.
                    const raced = attachable
                        ? { kind: 'item' as const, result: await step }
                        : await Promise.race([
                              step.then((result) => ({ kind: 'item' as const, result })),
                              scope.budget().then(() => ({ kind: 'budget' as const })),
                          ])
                    if (raced.kind === 'budget') return // budget hit — cut off; handle stays open (mode B resume).
                    if (raced.result.done === true) break
                    if (handle !== null) handle.values.push(raced.result.value)
                    yield { op: 'append', html: await config.renderItem(raced.result.value, i++) }
                    step = next()
                }
                markIterableDone(source)
                if (handle !== null) handle.done = true // completed within the budget → mode A on the client.
            } catch (error) {
                markIterableDone(source)
                if (handle !== null) dropHandle(scope, handle) // errored → drop the handle (client re-runs).
                if (config.caught !== null) yield { op: 'append', html: await config.caught(error) }
            }
        },
    })
    // The items are emitted BARE and the id'd `<template>` TRAILS them as the insertion point: each
    // `append` patch inserts before the sentinel, so document order is item order at O(1) per patch (no
    // container, so nothing can be foster-parented out of a table and a streamed `<tr>` lands as a real
    // `<tbody>` child). Hydration clears the whole region — items and sentinel — between the block anchors.
    return `${html}<template id="${listId}"></template>`
}

// One out-of-order patch: `fill` a `{#await}` slot, `append` a `{#for await}` item, or mark a streamed
// list `complete`. The transports frame it differently — the first-load document as a `<template>`
// +move-script (`documentPatch`, inline scripts run as the browser parses); the soft-nav JSONL stream
// as a `{kind, id, html?}` frame the client applies in JS (a fetched body's scripts don't auto-run).
export type Patch =
    | { op: 'fill'; id: number; html: string }
    | { op: 'append'; id: number; html: string }

// The first-load move-scripts, DEFINED ONCE per document — `documentPatchPreamble` writes the two DOM
// ops into the page and each patch then costs one call. They used to be inlined into every patch and
// deduplicated at runtime by `window.$abidePatch=window.$abidePatch||…`, which meant the whole body
// travelled once per streamed item; a fifty-row `{#for await}` shipped fifty copies of it.
//
// The ops themselves come from `streamPatchDom.ts`, stringified — the same functions `navigate`
// imports and calls directly for a soft nav, so the geometry has one implementation instead of a
// readable one and a minified one that had to be kept in step by hand.
export function documentPatchPreamble(): string {
    return (
        `<script>(function(){` +
        `var F=${String(abideFillSlot)};var A=${String(abideAppendItem)};` +
        `window.$abideFill=function(n){var t=document.querySelector('template[data-ab-patch="'+n+'"]');` +
        `if(t){F(n,t.content,'${STREAM_SENTINEL.pending}',document);t.remove();}};` +
        `window.$abideAppend=function(n){var t=document.querySelector('template[data-ab-append="'+n+'"]');` +
        `if(t){A(n,t.content,'${STREAM_SENTINEL.list}',document);t.remove();}};` +
        `})()</script>`
    )
}

// One out-of-order patch as document bytes: the content in a `<template>` the parser will not render,
// then the call that moves it. Requires `documentPatchPreamble()` to have been written earlier in the
// document — the transport does that before the first patch.
export function documentPatch(patch: Patch): string {
    if (patch.op === 'fill') {
        return (
            `<template data-ab-patch="${patch.id}">${patch.html}</template>` +
            `<script>$abideFill(${patch.id})</script>`
        )
    }
    if (patch.op === 'append') {
        return (
            `<template data-ab-append="${patch.id}">${patch.html}</template>` +
            `<script>$abideAppend(${patch.id})</script>`
        )
    }
    throw new Error(`documentPatch: unknown patch op ${(patch as { op: string }).op}`)
}

// Drain the deferred subtrees AND streamers, yielding each patch as it becomes ready (out-of-order — a
// fast subtree/item flushes before a slow sibling). A subtree resolves once (a `fill`); a streamer
// yields many `append`s then a `complete`. New deferreds/streamers registered mid-drain are picked up
// each loop.
export async function* drainPatches(scope: RenderStream): AsyncGenerator<Patch> {
    interface Ready {
        key: string
        patch: Patch | null // null = this source produced nothing more (drop it from the race).
        advance: (() => void) | null // re-arm a streamer for its next frame; null for a one-shot subtree.
    }
    const inFlight = new Map<string, Promise<Ready>>()
    const started = new Set<string>()

    const kickSubtree = (subtree: DeferredSubtree): void => {
        const key = `s${subtree.id}`
        started.add(key)
        inFlight.set(
            key,
            subtree.render().then((result) => ({
                key,
                patch: { op: 'fill', id: subtree.id, html: result.html } as Patch,
                advance: null,
            })),
        )
    }

    const kickStreamer = (streamer: DeferredStreamer): void => {
        const key = `l${streamer.id}`
        started.add(key)
        const generator = streamer.run()
        const pull = (): void => {
            inFlight.set(
                key,
                generator.next().then((step) => {
                    if (step.done === true) return { key, patch: null, advance: null }
                    const frame = step.value
                    const patch: Patch = { op: 'append', id: streamer.id, html: frame.html }
                    return { key, patch, advance: pull }
                }),
            )
        }
        pull()
    }

    for (const subtree of scope.deferred) kickSubtree(subtree)
    for (const streamer of scope.streamers) kickStreamer(streamer)
    while (inFlight.size > 0) {
        const ready = await Promise.race(inFlight.values())
        inFlight.delete(ready.key)
        if (ready.patch !== null) yield ready.patch
        if (ready.advance !== null) ready.advance()
        for (const subtree of scope.deferred)
            if (!started.has(`s${subtree.id}`)) kickSubtree(subtree)
        for (const streamer of scope.streamers)
            if (!started.has(`l${streamer.id}`)) kickStreamer(streamer)
    }
}
