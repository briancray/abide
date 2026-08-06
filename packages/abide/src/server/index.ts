// Server substrate: a TemplateResult becomes HTML.
//
// The walk is SYNCHRONOUS and suspends only where the tree genuinely waits. Reactivity is not
// involved: a thunk in a slot is simply CALLED. A server render is a snapshot, so there is nothing
// to subscribe to and no effects are created.
//
// It used to be one async generator, which read beautifully and cost about seven microtask ticks per
// row: an async generator's `next()` hands back a promise even for a value it already has, and every
// `yield*` level pays that again. Measured on a thousand-row table — an async generator against the
// same walk writing into a buffer — that is 2550 ns per row against 115 ns, and the honest number
// against a hand-written concat was 74x. So the shape here is inverted: `emit` writes into `Out` and
// returns `null` when it finished without waiting, or the promise for the REST of its work when it
// could not. Nothing but a real promise, a real async iterable, or a consumer applying back-pressure
// makes it return anything.
//
// A streaming consumer is served by `stream`, which is the ONE place the generator lives. It is an
// adapter over the same walk rather than a second one: two walks that could disagree about what the
// markup is would be a whole bug class, and one walk is what makes that class unreachable.

import {
    Awaited,
    Boundary,
    escape,
    isKeyed,
    isTemplate,
    type Keyed,
    Raw,
    Streamed,
    settledArms,
    settledBoundary,
    type TemplateResult,
} from '$shared/html.ts'
import { closeMarker, OPEN_MARKER } from '$shared/internal/MARKERS.ts'
import { isAsyncIterable, isThenable } from '$shared/internal/probes.ts'
import { slotsOf, unwrap } from '$shared/internal/slots.ts'
import { styleTags } from '$shared/styles.ts'
import {
    attribute,
    type Deferred,
    PATCH_SCRIPT,
    PLAIN,
    type RenderContext,
    type RenderOptions,
} from './internal/emit.ts'

/** Everything the walk knows how to write. */
export type Renderable =
    | string
    | number
    | bigint
    | boolean
    | null
    | undefined
    | Raw
    | TemplateResult
    | Keyed
    | Awaited
    | Boundary
    | Streamed
    | Suspend
    | Renderable[]
    | Promise<Renderable>
    | AsyncIterable<Renderable>
    | (() => Renderable)

// A subtree the author asked to be streamed out of order. A plain marker in the node tree — the
// walker gives it an id when it reaches it, so nothing ambient correlates placeholder with patch.
export class Suspend {
    constructor(
        readonly value: unknown,
        readonly body: (value: never) => Renderable,
        readonly fallback: Renderable,
    ) {}
}

// `PromiseLike` rather than `Promise` so a cell can be suspended directly: `state`/`memo` are
// thenable, and `suspend(user, …)` is how a load reaches SSR, where there is nothing to wake later.
export function suspend<T>(
    value: PromiseLike<T> | T,
    body: (value: T) => Renderable,
    fallback: Renderable = null,
): Renderable {
    return new Suspend(value, body as (v: never) => Renderable, fallback)
}

// --- where the markup goes ---------------------------------------------------

/**
 * The buffer the walk writes into, and the two things a streaming consumer adds to it.
 *
 * `flush` is null when nobody is consuming incrementally — `renderToString` wants the whole document
 * and there is nothing to hand anyone early — and that null is what makes the common render a walk
 * with no promises in it at all.
 */
interface Out {
    text: string
    /** Hand the buffer over. Resolves once the consumer is ready for more, so it IS the back-pressure. */
    flush: (() => Promise<void>) | null
    /** Flush once the buffer passes this many characters, so a long SYNC run stays bounded. */
    mark: number
}

/** `null` means the node is fully written; a promise means the rest of it will be. */
type Rest = Promise<void> | null

/** How much a streaming render buffers before handing a chunk over. */
const HIGH_WATER = 8192

function then_(waiting: Promise<void>, rest: () => Rest): Promise<void> {
    return waiting.then(() => {
        const more = rest()
        return more === null ? undefined : more
    })
}

/** Over the mark? Then the buffer goes out and the walk waits for the consumer. */
function paused(out: Out): Promise<void> | null {
    if (out.flush === null || out.text.length === 0 || out.text.length < out.mark) return null
    return out.flush()
}

/**
 * Everything written so far goes out BEFORE the walk waits.
 *
 * That is what "streams in document order" means and it is the only moment a consumer could be
 * starved: a slot that has to wait holds the walk, and everything before it is already out.
 */
async function handOver(out: Out): Promise<void> {
    if (out.flush !== null) await out.flush()
}

// --- the walk ----------------------------------------------------------------

function emit(node: Renderable, context: RenderContext, out: Out): Rest {
    // The typeof switch FIRST. A thousand-row table's slot values are strings and numbers, and the
    // brand checks below are seven prototype probes each of them would otherwise pay to get here.
    switch (typeof node) {
        case 'string':
            out.text += escape(node)
            return null
        case 'number':
        case 'bigint':
            out.text += String(node)
            return null
        case 'boolean':
        case 'undefined':
            return null
        case 'function':
            return emit((node as () => Renderable)(), context, out)
    }
    if (node === null) return null

    if (isTemplate(node)) return emitTemplate(node, context, out, 0)
    if (Array.isArray(node)) return emitArray(node, context, out, 0)
    if (node instanceof Raw) {
        out.text += node.html
        return null
    }
    if (isKeyed(node)) {
        // A key says WHICH row this is, which only matters to a renderer that moves rows. Here it is
        // simply carried: the row renders, the key is dropped. Without this a keyed list — the thing
        // `{#for … by key}` compiles to — stringified its wrappers into `[object Object]`.
        return emit(node.template, context, out)
    }
    if (node instanceof Awaited) {
        const operand = node.value
        // A server render is a snapshot with nothing to wake later, so it AWAITS rather than showing
        // the pending branch — the same choice `Suspend` makes when there is no document to patch.
        // `suspend(value, …)` is still how a load reaches SSR out of order.
        if (!isThenable(operand)) {
            return emit(settledArms(node.branches, undefined, operand, false) as Renderable, context, out)
        }
        return emitAwaited(node, context, out)
    }
    if (node instanceof Boundary) {
        // Synchronous, like the `try` it is named after. A body that returns a promise is rendered
        // below in the ordinary way, and its rejection is NOT this boundary's to catch.
        return emit(settledBoundary(node) as Renderable, context, out)
    }
    if (node instanceof Streamed) return emitStreamed(node, context, out)
    if (node instanceof Suspend) return emitSuspend(node, context, out)
    if (isThenable(node)) return emitPromise(node, context, out)
    if (isAsyncIterable(node)) return emitAsyncIterable(node, context, out)

    out.text += escape(String(node))
    return null
}

/**
 * One template, resumable at slot `from`.
 *
 * Resumption is what replaces the generator: a slot that suspends returns the promise for
 * "everything after me", built by calling back into this function with the next index. The closure
 * is allocated only on the branch that actually waited.
 */
function emitTemplate(result: TemplateResult, context: RenderContext, out: Out, from: number): Rest {
    const kinds = slotsOf(result)
    const { strings, values } = result

    for (let i = from; i < strings.length; i++) {
        let text = strings[i] as string
        const kind = kinds[i]

        // An attribute/event/property slot owns the `name=` that precedes it, so that markup must
        // not reach the output verbatim.
        if (kind !== undefined && kind.kind !== 'child') text = text.slice(0, text.length - kind.staticTail)
        out.text += text

        if (kind === undefined) continue
        const value = values[i]

        switch (kind.kind) {
            case 'child': {
                // The two markers a hydrating client adopts by. They bracket the VALUE, which is the
                // one part of the output the client's template does not already describe.
                if (context.hydratable) out.text += OPEN_MARKER
                const slot = i
                const waiting = emit(value as Renderable, context, out)
                if (waiting !== null) {
                    return then_(waiting, () => {
                        if (context.hydratable) out.text += closeMarker(slot)
                        return emitTemplate(result, context, out, slot + 1)
                    })
                }
                if (context.hydratable) out.text += closeMarker(slot)
                const pause = paused(out)
                if (pause !== null) {
                    return then_(pause, () => emitTemplate(result, context, out, slot + 1))
                }
                break
            }
            case 'attr':
                // `unwrap`, not a bare call: a thunk handing back a SOURCE is read one step further,
                // and the client's binder does exactly that. Calling once left `class=${() => cls}`
                // rendering the cell's own source text where the client renders its value.
                out.text += attribute(kind.name, unwrap(value))
                break
            case 'event':
                // No listeners in a string. The client attaches it on mount.
                break
            case 'property':
                // A DOM property has no serialisation. Deliberately emits nothing — see README
                // "Known limits"; use an attribute slot when the value must survive SSR.
                break
            case 'ref':
                // A node reference, and there are no nodes here. Client-only by definition.
                break
            case 'spread': {
                const spread = unwrap(value) as Record<string, unknown> | null | undefined
                if (spread === null || spread === undefined) break
                for (const name in spread) out.text += attribute(name, spread[name])
                break
            }
        }
    }
    return null
}

function emitArray(nodes: Renderable[], context: RenderContext, out: Out, from: number): Rest {
    for (let i = from; i < nodes.length; i++) {
        const at = i
        const waiting = emit(nodes[i] as Renderable, context, out)
        if (waiting !== null) {
            return then_(waiting, () => emitArray(nodes, context, out, at + 1))
        }
        const pause = paused(out)
        if (pause !== null) return then_(pause, () => emitArray(nodes, context, out, at + 1))
    }
    return null
}

// The four branches that genuinely wait. Written as `async` functions rather than as more
// resumption: they are the slow path by definition, so readable beats allocation-free here.

async function emitAwaited(node: Awaited, context: RenderContext, out: Out): Promise<void> {
    await handOver(out)
    let arms: unknown
    try {
        arms = settledArms(node.branches, undefined, await node.value, false)
    } catch (error) {
        // No `{:catch}` means the author did not claim to handle it, so it stays a failure.
        if (node.branches.catch === undefined) throw error
        arms = settledArms(node.branches, error, undefined, true)
    }
    const more = emit(arms as Renderable, context, out)
    if (more !== null) await more
}

// Taken and awaited through `unknown`: `Renderable` includes `Promise<Renderable>`, so a `PromiseLike<Renderable>`
// here makes the fulfillment type reference itself.
async function emitPromise(node: PromiseLike<unknown>, context: RenderContext, out: Out): Promise<void> {
    await handOver(out)
    const settled: unknown = await node
    const more = emit(settled as Renderable, context, out)
    if (more !== null) await more
}

async function emitStreamed(node: Streamed, context: RenderContext, out: Out): Promise<void> {
    await handOver(out)
    try {
        let index = 0
        for await (const item of node.source as AsyncIterable<never>) {
            const more = emit(node.row(item, index++) as Renderable, context, out)
            if (more !== null) await more
            await handOver(out)
        }
    } catch (error) {
        if (node.failure === undefined) throw error
        const more = emit(node.failure(error) as Renderable, context, out)
        if (more !== null) await more
    }
}

async function emitAsyncIterable(
    node: AsyncIterable<unknown>,
    context: RenderContext,
    out: Out,
): Promise<void> {
    await handOver(out)
    for await (const child of node) {
        const more = emit(child as Renderable, context, out)
        if (more !== null) await more
        await handOver(out)
    }
}

function emitSuspend(node: Suspend, context: RenderContext, out: Out): Rest {
    const document = context.document
    // No document to patch (a component rendered to a string) → await it inline.
    if (document === null) return emitSuspendInline(node, context, out)

    const id = document.nextId++
    document.deferred.push({
        id,
        html: (async () => {
            try {
                return await renderToString(node.body((await node.value) as never), {
                    hydratable: context.hydratable,
                })
            } catch (error) {
                return `<!-- suspend ${id} failed: ${escape(String(error))} -->`
            }
        })(),
    })
    out.text += `<slot-s id="s${id}">`
    const waiting = emit(node.fallback, PLAIN, out) // a placeholder must not itself defer
    if (waiting !== null) {
        return then_(waiting, () => {
            out.text += '</slot-s>'
            return null
        })
    }
    out.text += '</slot-s>'
    return null
}

async function emitSuspendInline(node: Suspend, context: RenderContext, out: Out): Promise<void> {
    await handOver(out)
    const more = emit(node.body((await node.value) as never), context, out)
    if (more !== null) await more
}

// --- the streaming face ------------------------------------------------------

// A consumer that breaks out of `for await` abandons the walk. The rejection is what unwinds it, so
// an infinite source inside it — a channel's async iterator — gets its `return()` and stops.
const ABANDONED = Symbol('abide.abandoned')

/**
 * The walk, as chunks.
 *
 * A chunk boundary is a SUSPENSION, not a string segment: the walk hands over what it has written
 * whenever it is about to wait, and again whenever the buffer passes the high-water mark. Those two
 * are the whole of the streaming contract — a slot that has to load holds the walk and everything
 * before it is already out, and an all-synchronous page cannot buffer without bound.
 *
 * Chunking more finely than that is not free and buys nothing. Handing over after every RESOLVED
 * slot as well cost a full consumer round trip per slot — about eleven microtask turns per row of a
 * list, measured, against none for the same render into a string — to split markup nobody was
 * waiting on into more pieces.
 */
function stream(node: Renderable, context: RenderContext): AsyncGenerator<string> {
    const queue: string[] = []
    let wakeConsumer: (() => void) | null = null
    let resumeWalk: (() => void) | null = null
    let rejectWalk: ((reason: unknown) => void) | null = null
    let abandoned = false
    let finished = false
    let failure: unknown = null
    let failed = false

    const out: Out = {
        text: '',
        mark: HIGH_WATER,
        flush(): Promise<void> {
            if (out.text !== '') {
                queue.push(out.text)
                out.text = ''
            }
            const wake = wakeConsumer
            wakeConsumer = null
            if (wake !== null) wake()
            if (abandoned) return Promise.reject(ABANDONED)
            return new Promise<void>((resolve, reject) => {
                resumeWalk = () => resolve()
                rejectWalk = reject
            })
        },
    }

    // Taken through a function with a DECLARED return type: `flush` is the only writer and it is a
    // closure the checker does not follow, so a plain read of either variable narrows to the `null`
    // it was declared with — and then to `never` the moment it is tested.
    function takeResume(): (() => void) | null {
        const held = resumeWalk
        resumeWalk = null
        rejectWalk = null
        return held
    }

    function takeReject(): ((reason: unknown) => void) | null {
        const held = rejectWalk
        resumeWalk = null
        rejectWalk = null
        return held
    }

    async function walk(): Promise<void> {
        try {
            const waiting = emit(node, context, out)
            if (waiting !== null) await waiting
        } catch (error) {
            if (error !== ABANDONED) {
                failed = true
                failure = error
            }
        }
        if (out.text !== '') {
            queue.push(out.text)
            out.text = ''
        }
        finished = true
        const wake = wakeConsumer
        wakeConsumer = null
        if (wake !== null) wake()
    }

    return (async function* () {
        // Started here rather than above, so building the generator does no work until it is read.
        const walking = walk()
        try {
            for (;;) {
                while (queue.length > 0) yield queue.shift() as string
                if (finished) break
                const resume = takeResume()
                if (resume !== null) resume()
                await new Promise<void>((resolve) => {
                    wakeConsumer = () => resolve()
                })
            }
        } finally {
            abandoned = true
            const reject = takeReject()
            if (reject !== null) reject(ABANDONED)
        }
        await walking
        if (failed) throw failure
    })()
}

/** The walk as a stream of chunks — one per suspension, and one per buffer-full of markup. */
export function render(node: Renderable, options?: RenderOptions): AsyncGenerator<string> {
    return stream(node, contextFor(options))
}

function contextFor(options: RenderOptions | undefined): RenderContext {
    if (options === undefined || options.hydratable !== true) return PLAIN
    return { hydratable: true, document: null }
}

// Returning `Promise.resolve(out.text)` by hand instead of being `async` was tried and reverted:
// JSC gives an async function that never awaits the same 160 ns a bare `Promise.resolve` costs, so
// the hand-rolled form bought nothing and read worse. The fixed cost of a small render is the slot
// scan and the promise the caller awaits, not the shape of this function.
export async function renderToString(node: Renderable, options?: RenderOptions): Promise<string> {
    // No `flush`, so nothing in the walk can pause: a tree with no promises in it produces the whole
    // document without a single microtask, which is the entire reason `emit` is shaped this way.
    const out: Out = { text: '', flush: null, mark: Infinity }
    const waiting = emit(node, contextFor(options), out)
    if (waiting !== null) await waiting
    return out.text
}

export function toStream(node: Renderable, options?: RenderOptions): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    const chunks = stream(node, contextFor(options))
    return new ReadableStream({
        async pull(controller) {
            const step = await chunks.next()
            if (step.done) controller.close()
            else controller.enqueue(encoder.encode(step.value))
        },
        cancel: (reason) => void chunks.return?.(reason as never),
    })
}

// A whole document: shell, body streamed in order, then out-of-order patches as they resolve.
export async function* renderDocument(
    head: string,
    body: () => Renderable,
    options?: RenderOptions,
): AsyncGenerator<string> {
    const document = { nextId: 0, deferred: [] as Deferred[] }
    const context: RenderContext = { hydratable: options?.hydratable === true, document }
    // Every scoped `<style>` registers at MODULE scope, so by the time a render starts, every
    // component that was imported has already declared its rules — which is why the whole sheet can
    // go out in the shell without tracking what this particular render reached. Each block carries
    // its scope name, which is what stops the client appending a second copy of every one.
    yield `<!doctype html><html><head>${head}${styleTags()}</head><body>`
    yield PATCH_SCRIPT
    yield* stream(body(), context)

    // `deferred` is append-only and one cursor says what has been armed. Re-scanning it instead
    // would re-arm what was already flushed and spin forever.
    // The race carries the settled MARKUP, not the deferred: `ready.html` is settled by definition
    // once it wins, so awaiting it again would buy a microtask tick per suspended subtree.
    const inFlight = new Map<number, Promise<{ id: number; text: string }>>()
    let cursor = 0
    const arm = (): void => {
        for (; cursor < document.deferred.length; cursor++) {
            const d = document.deferred[cursor] as Deferred
            inFlight.set(
                d.id,
                d.html.then((text) => ({ id: d.id, text })),
            )
        }
    }
    arm()
    while (inFlight.size > 0) {
        const ready = await Promise.race(inFlight.values())
        inFlight.delete(ready.id)
        yield `<template id="t${ready.id}">${ready.text}</template><script>$p(${ready.id})</script>`
        arm() // a patch may itself have registered more
    }
    yield `</body></html>`
}

// What every renderer here takes. `RenderContext` stays internal: it is the walk's own state, and
// its `document` field is typed by a `DocumentContext` no caller can name.
export type { RenderOptions } from './internal/emit.ts'
// The one part of routing that is NOT isomorphic, because a filesystem is not. What it hands back is
// an ordinary route table, and `routes()` takes the same one on either side.
export { pages } from './pages.ts'
// The caller scope and its ambients. `serve` is what makes every module-level `memo` per-request.
export { bag, cookies, isServing, request, serve } from './scopes.ts'
