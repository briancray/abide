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
    cellProps,
    Component,
    escape,
    isKeyed,
    isTemplate,
    type Keyed,
    Raw,
    Streamed,
    settledArms,
    settledBoundary,
    started,
    type TemplateResult,
} from '$shared/html.ts'
import { abideLog } from '$shared/log.ts'
import { renderBudget } from '$shared/internal/ceilings.ts'
import { isPending, type Pending, retryable, retryableCall, settledOf } from '$shared/internal/graph.ts'
import {
    closeMarker,
    OPEN_MARKER,
    PIECE_END,
    PLACEHOLDER_TAG,
    patchId,
    placeholderId,
} from '$shared/internal/MARKERS.ts'
import { isAsyncIterable, isThenable, messageOf } from '$shared/internal/probes.ts'
import { seedScript } from '$shared/internal/seed.ts'
import { planOf, unwrap } from '$shared/internal/slots.ts'
import { arm, NO_LIMIT, timeoutError } from '$shared/internal/timers.ts'
// Re-exported below as well: `<head>` is the only place a sheet is written as markup, so this is a
// SERVER name that happened to live in `$shared` because `adopt()` fills the registry it reads.
import { styleTags } from '$shared/styles.ts'
import {
    attribute,
    type Deferred,
    type DocumentContext,
    nonceAttribute,
    PLAIN,
    patchScript,
    type RenderContext,
    type RenderOptions,
} from './internal/emit.ts'
// Imported for its side effect as much as for `appDataDir`: it installs the package.json fallback
// under `ABIDE_APP_NAME`, which is what names `log`'s default channel. Importing `abide/server` at
// all is the signal that there is a filesystem to ask.
import './app.ts'
import { closeSeeding, heldPump, holdScope, isServing, nonce, openSeeding } from './scopes.ts'
import { type Shell, shellAround } from './shell.ts'

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
    | Component
    | Streamed
    | Renderable[]
    | Promise<Renderable>
    | AsyncIterable<Renderable>
    | (() => Renderable)

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
    /**
     * Hand the buffer over. The promise resolves once the consumer is ready for more, so it IS the
     * back-pressure — and `null` means it is already ready, so there was never anything to wait for.
     */
    flush: (() => Promise<void> | null) | null
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

/**
 * Over the mark? Then the buffer goes out and the walk waits for the consumer.
 *
 * `HIGH_WATER` directly rather than a field on `Out`: only a streaming walk has a `flush`, and every
 * streaming walk buffers to the same mark — a per-`Out` number would be a knob with one live value,
 * read here per child slot and per array element.
 */
function paused(out: Out): Promise<void> | null {
    if (out.flush === null || out.text.length < HIGH_WATER) return null
    return out.flush()
}

/**
 * Everything written so far goes out BEFORE the walk waits.
 *
 * That is what "streams in document order" means and it is the only moment a consumer could be
 * starved: a slot that has to wait holds the walk, and everything before it is already out.
 *
 * NOT `async`, and guarded at every call site like `Rest` beside it: `renderToString` has no
 * consumer at all — including inside every deferred boundary, which renders through it — so an
 * unconditional promise here costs a wrap and a tick PER ROW of a streamed list to learn that.
 */
function handOver(out: Out): Promise<void> | null {
    return out.flush === null ? null : out.flush()
}

// --- the walk ----------------------------------------------------------------

function emit(node: Renderable, context: RenderContext, out: Out): Rest {
    // The typeof switch FIRST. A thousand-row table's slot values are strings and numbers, and the
    // brand checks below are seven prototype probes each of them would otherwise pay to get here.
    //
    // Which is why what a plain value renders as is spelled here rather than called: this is the
    // child-position half of the rule `$ui`'s `textOf` states, and the two lanes have to agree or a
    // hydration mismatch follows. Nullish and BOTH booleans are nothing; everything else is `String`.
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
            // `emitProduced` takes the thunk itself, so the common arm allocates nothing it did not
            // already.
            return emitProduced(node as () => Renderable, context, out)
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
        // Nothing to wait for is nothing to defer, and nothing to await either.
        if (!isThenable(operand)) {
            return emitProduced(() => armsOf(node, operand, false), context, out)
        }
        // THE PENDING ARM IS THE DECISION, and it is the only thing that had to be read. An `{#if}`
        // chain whose first test is a `pending()` probe emits one — asking about a load is having
        // something to show while it runs — so it goes out as a placeholder and is patched in when
        // the load settles. Every other chain emits none, so there is nothing to send and the walk
        // blocks until the value lands; see `deferrable` in `$compiler`.
        //
        // That distinction is what an author is choosing between, and it is not a detail: a deferred
        // subtree arrives through a `<template>` and a two-line script, so it needs JAVASCRIPT. A
        // reader running none — a crawler, a mail client, `curl` — sees the placeholder forever.
        // Blocking is what puts the settled markup in the HTML, and the compact form is how it is
        // asked for. A render with nowhere to patch blocks either way.
        if (context.document !== null && node.branches.pending !== undefined) {
            return emitDeferred(node, context, out)
        }
        return emitAwaited(node, context, out)
    }
    if (node instanceof Component) {
        // A snapshot has no instance to KEEP, so the call is the whole of the render — and it is a
        // producer like any other, since a `<script>` may read a load. The props are still wrapped:
        // what a component receives is cells on both sides, and a lane that handed the plain values
        // over would work for every compiled `.abide` file and break every hand-written one.
        return emitProduced(() => node.view(cellProps(node.props)) as Renderable, context, out)
    }
    if (node instanceof Boundary) {
        // Synchronous, like the `try` it is named after. A body that returns a promise is rendered
        // below in the ordinary way, and its rejection is NOT this boundary's to catch.
        //
        // Through `emitProduced` because the body runs HERE rather than in the thunk that handed the
        // boundary over — outside a catcher a cold read inside a `{#try}` signals to nobody, and the
        // region renders empty on a snapshot the walk could have waited for. One closure per
        // boundary, which is per REGION rather than per row.
        return emitProduced(() => settledBoundary(node) as Renderable, context, out)
    }
    if (node instanceof Streamed) return emitStreamed(node, context, out)
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
    const { kinds, texts } = planOf(result)
    const values = result.values

    for (let i = from; i < texts.length; i++) {
        // Already cut: an attribute/event/property slot owns the `name=` that precedes it, and that
        // slice now happens once per call site rather than once per slot per row. `texts` is also a
        // packed copy of a FROZEN array, which is the larger half of why this loop reads it — see
        // `TemplatePlan`.
        out.text += texts[i] as string

        const kind = kinds[i]
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
            case 'attr': {
                // `unwrap`, not a bare call: a thunk handing back a SOURCE is read one step further,
                // and the client's binder does exactly that. Calling once left `class=${() => cls}`
                // rendering the cell's own source text where the client renders its value.
                //
                // A catcher here as much as in a child slot, and the asymmetry it fixes is invisible:
                // the client BINDS `class=${() => tone()}` once the load lands, so a server that let
                // the read serve `undefined` dropped an attribute the client then had — markup that
                // is wrong for anyone running no scripts, and nothing compares the two.
                const name = kind.name
                let produced: unknown
                try {
                    produced = retryableCall(unwrap, value)
                } catch (error) {
                    if (!isPending(error)) throw error
                    // Resumed at the NEXT slot, and the attribute written here: the static text in
                    // front of this one is already in the buffer, so the walk cannot re-enter at it.
                    const slot = i
                    return awaitedProduce(error, () => unwrap(value), out).then((settled) => {
                        out.text += attribute(name, settled)
                        const rest = emitTemplate(result, context, out, slot + 1)
                        return rest === null ? undefined : rest
                    })
                }
                out.text += attribute(name, produced)
                break
            }
            case 'event':
                // No listeners in a string. The client attaches it on mount.
                break
            case 'property':
                // A DOM property has no serialisation. Deliberately emits nothing — see SPEC's
                // "Known limits"; use an attribute slot when the value must survive SSR.
                break
            case 'ref':
                // A node reference, and there are no nodes here. Client-only by definition.
                break
            case 'spread': {
                let spread: unknown
                try {
                    spread = retryableCall(unwrap, value)
                } catch (error) {
                    if (!isPending(error)) throw error
                    const slot = i
                    return awaitedProduce(error, () => unwrap(value), out).then((settled) => {
                        writeSpread(settled, out)
                        const rest = emitTemplate(result, context, out, slot + 1)
                        return rest === null ? undefined : rest
                    })
                }
                writeSpread(spread, out)
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
//
// One arm no longer always waits — a `streamed()` over a SYNC iterable under `renderToString` has
// neither a source to await nor a consumer to flush to, so it returns a promise for work already
// done and each enclosing level pays a `then_` and a tick to resume it. Left `async`: unwinding it
// means the resumption shape `emitArray` uses, and that is real machinery for the one case where a
// block declared `{#for await}` was handed something that never awaits.

function writeSpread(spread: unknown, out: Out): void {
    if (spread === null || spread === undefined) return
    const fields = spread as Record<string, unknown>
    for (const name in fields) {
        out.text += attribute(name, fields[name])
    }
}

/**
 * The ONE recovery a snapshot has: wait out the load a read could not serve, and call the producer
 * again — as many times as it takes, since a body reading three loads signals once per load.
 *
 * Hands the VALUE back rather than writing it, because every caller does something different with it:
 * a child slot emits it, an attribute writes itself and resumes the template at the NEXT slot (the
 * static text in front of its own is already in the buffer), a deferred block renders it through
 * a nested walk. Everything written so far goes out first, exactly as any other suspension does.
 */
async function awaitedProduce(signal: Pending, produce: () => unknown, out: Out): Promise<unknown> {
    const handed = handOver(out)
    if (handed !== null) await handed
    for (;;) {
        try {
            await settledOf(signal)
        } catch {
            // Waited out, not handled: a FAILED load is reported by the read itself on the next call,
            // so the throw arrives with the author's own expression under it rather than from here.
        }
        try {
            return retryable(produce)
        } catch (error) {
            if (!isPending(error)) throw error
            signal = error
        }
    }
}

/**
 * The settled arms of a block, which are BODIES: they can read, so they are a producer like a slot
 * thunk. A settled arm that throws reaches the failure arm exactly as a rejected operand does — and a
 * signal is not a throw of that kind, so it travels on to the walk.
 */
function armsOf(node: Awaited, settled: unknown, failed: boolean): Renderable {
    if (failed) return settledArms(node.branches, settled, undefined, true) as Renderable
    try {
        return settledArms(node.branches, undefined, settled, false) as Renderable
    } catch (error) {
        if (isPending(error) || node.branches.catch === undefined) throw error
        return settledArms(node.branches, error, undefined, true) as Renderable
    }
}

/**
 * Run something that PRODUCES a renderable, with a catcher standing under it, and emit what it made.
 *
 * The one shape both producers in the walk take: a slot thunk, and a `{#try}` body. What makes it a
 * catcher is that `produce` can be called again — which is the whole recovery a snapshot has.
 */
function emitProduced(produce: () => Renderable, context: RenderContext, out: Out): Rest {
    let produced: Renderable
    try {
        produced = retryable(produce)
    } catch (error) {
        if (!isPending(error)) throw error
        return awaitPending(error, produce, context, out)
    }
    return emit(produced, context, out)
}

/**
 * A slot whose read had nothing to serve yet: wait for that load, then call the producer AGAIN.
 *
 * Re-calling is the server's whole half of "a pending read signals" — there is no effect to wake in a
 * snapshot render, so the walk itself is what runs the body a second time. Everything written so far
 * goes out first, exactly as every other suspension does, and a thunk that signals on a SECOND cell
 * simply waits again: a page reading three loads resolves them one pass each, with no block form
 * naming any of them. Termination is the wall budget the whole walk is already raced against.
 */
async function awaitPending(
    signal: Pending,
    produce: () => Renderable,
    context: RenderContext,
    out: Out,
): Promise<void> {
    const produced = (await awaitedProduce(signal, produce, out)) as Renderable
    const rest = emit(produced, context, out)
    if (rest !== null) await rest
}

async function emitAwaited(node: Awaited, context: RenderContext, out: Out): Promise<void> {
    const handed = handOver(out)
    if (handed !== null) await handed
    let settled: unknown
    let failed = false
    try {
        settled = await node.value
    } catch (error) {
        // No `{:catch}` means the author did not claim to handle it, so it stays a failure.
        if (node.branches.catch === undefined) throw error
        settled = error
        failed = true
    }
    // Through `emitProduced` because the arms are BODIES — see `armsOf`.
    const more = emitProduced(() => armsOf(node, settled, failed), context, out)
    if (more !== null) await more
}

// Taken and awaited through `unknown`: `Renderable` includes `Promise<Renderable>`, so a `PromiseLike<Renderable>`
// here makes the fulfillment type reference itself.
async function emitPromise(node: PromiseLike<unknown>, context: RenderContext, out: Out): Promise<void> {
    const handed = handOver(out)
    if (handed !== null) await handed
    const settled: unknown = await node
    const more = emit(settled as Renderable, context, out)
    if (more !== null) await more
}

async function emitStreamed(node: Streamed, context: RenderContext, out: Out): Promise<void> {
    const handed = handOver(out)
    if (handed !== null) await handed
    try {
        let index = 0
        // `streamed()` takes `AsyncIterable<T> | Iterable<T>`, and a sync source has nothing to wait
        // on: `for await` over one wraps every item in a promise and pays a tick per ROW to learn
        // that. The browser half of this walk forks the same way, on the same probe.
        //
        // The row body is a PRODUCER like the two above — it runs here rather than in the thunk that
        // handed the block over — so a cold read in a row signals to this walk instead of to nobody.
        // One closure per row on both arms. Threading `(item, at)` instead would need the retry in
        // `awaitPending` to carry them too; unmeasured against the emit it wraps, so not done.
        if (isAsyncIterable(node.source)) {
            for await (const item of node.source as AsyncIterable<never>) {
                const at = index++
                const more = emitProduced(() => node.row(item, at) as Renderable, context, out)
                if (more !== null) await more
                const handed = handOver(out)
                if (handed !== null) await handed
            }
        } else {
            for (const item of node.source as Iterable<never>) {
                const at = index++
                const more = emitProduced(() => node.row(item, at) as Renderable, context, out)
                if (more !== null) await more
                // `paused`, not `handOver`: a chunk boundary is a SUSPENSION, and a sync source has
                // none to mark. `handOver` flushes unconditionally, and its promise only settles when
                // the consumer comes back for more — so this row loop would cost a full consumer
                // round trip per ROW, which is what the array walk uses `paused` to avoid.
                const pause = paused(out)
                if (pause !== null) await pause
            }
        }
    } catch (error) {
        if (node.failure === undefined) throw error
        const failure = node.failure
        const more = emitProduced(() => failure(error) as Renderable, context, out)
        if (more !== null) await more
    }
}

async function emitAsyncIterable(
    node: AsyncIterable<unknown>,
    context: RenderContext,
    out: Out,
): Promise<void> {
    const handed = handOver(out)
    if (handed !== null) await handed
    for await (const child of node) {
        const more = emit(child as Renderable, context, out)
        if (more !== null) await more
        const handed = handOver(out)
        if (handed !== null) await handed
    }
}

const PLACEHOLDER_CLOSE = `</${PLACEHOLDER_TAG}>`

/** Abide's own channel for what a render could not say in the markup. Off unless `DEBUG` names it —
 *  except `error`, which the gate never swallows, and a subtree that failed with nowhere to report it
 *  is exactly what that exception is for. */
const renderLog = abideLog.channel('render')

/**
 * A block sent as a placeholder now and patched in when it settles.
 *
 * Reached only with a document to patch AND a pending arm to send — the dispatch above decides both,
 * so there is no guard to repeat here.
 */
function emitDeferred(node: Awaited, context: RenderContext, out: Out): Rest {
    const document = context.document as DocumentContext
    const id = document.nextId++
    // STARTED here, synchronously, and awaited below — see `started`. The pending arm is arbitrary
    // code that may probe or read this very operand, which is exactly what `{#if x.pending()}`
    // compiles to, and `await` would not have reached a lazy operand's `then` until after that arm
    // had already run and been told there was no load.
    const settling = started(node.value as PromiseLike<unknown>)
    document.deferred.push({
        id,
        html: (async () => {
            let settled: unknown
            let failed = false
            try {
                settled = await settling
            } catch (error) {
                // `drain` is built on `html` never rejecting, and that is not an implementation
                // detail to route around: the shell went out with the placeholder in it, so by the
                // time this fails there is nothing left to fail INTO. A throw here would be an
                // unhandled rejection over a response already half-written.
                //
                // So a `{:catch}` renders — which is the whole of what this path gained over the
                // `suspend` it replaced, where a failed load had no arm to reach for. Without one it
                // is still a comment, because the author did not say what to show; it is said out
                // loud on abide's own channel rather than only to a reader viewing source.
                if (node.branches.catch === undefined) {
                    renderLog.error(`a deferred block failed with no failure arm: ${messageOf(error)}`)
                    return `<!-- await ${id} failed: ${escape(String(error))} -->`
                }
                settled = error
                failed = true
            }
            // The arms are a producer here too, and this walk is the one that waits for them: a
            // deferred boundary renders through `renderToString`, which is handed what they MADE.
            let arms: Renderable
            try {
                arms = retryable(() => armsOf(node, settled, failed))
            } catch (error) {
                if (!isPending(error)) throw error
                arms = (await awaitedProduce(error, () => armsOf(node, settled, failed), out)) as Renderable
            }
            return await renderToString(arms, { hydratable: context.hydratable })
        })(),
    })
    out.text += `<${PLACEHOLDER_TAG} id="${placeholderId(id)}">`
    // PLAIN, because a placeholder must not itself defer: it is markup the client adopts as one
    // piece and replaces whole. Through `emitProduced` because the arm is a BODY like every other —
    // a `{#if x.pending()}` chain reads the very cell this block is waiting for.
    const waiting = emitProduced(node.branches.pending as () => Renderable, PLAIN, out)
    if (waiting !== null) {
        return then_(waiting, () => {
            out.text += PLACEHOLDER_CLOSE
            return null
        })
    }
    out.text += PLACEHOLDER_CLOSE
    return null
}

/**
 * One render's wall budget: a single clock every PHASE of that render races against.
 *
 * A document render has two — the in-order walk, and the out-of-order drain after it — and a
 * deferred block under a document defers into the second. A clock armed per phase would be a per-phase budget
 * wearing a wall budget's name, and a page that suspends is exactly the page the budget is for.
 *
 * Armed on the first phase that actually WAITS, so a synchronous page still costs no timer: the
 * rejection is built once and handed to every race after it, which is also why it can never go
 * unhandled — it is created inside the `Promise.race` that consumes it.
 */
class Budget {
    private timer: ReturnType<typeof setTimeout> | null = null
    private expires: Promise<never> | null = null
    constructor(private readonly limit: number) {}

    /** `waiting`, or the deadline — whichever lands first. */
    race<V>(waiting: Promise<V>): Promise<V> {
        let expires = this.expires
        if (expires === null) {
            expires = new Promise<never>((_, reject) => {
                const limit = this.limit
                this.timer = arm(() => reject(timeoutError('the SSR stream', 'did not finish', limit)), limit)
            })
            this.expires = expires
        }
        return Promise.race([waiting, expires])
    }

    /** The render is over. A finished one must not hold a timer for the rest of its budget. */
    close(): void {
        if (this.timer !== null) clearTimeout(this.timer)
    }
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
function stream(node: Renderable, context: RenderContext, budget: Budget | null): AsyncGenerator<string> {
    // A clock handed in belongs to the render that made it — a document's, spanning this walk AND
    // the drain after it. One made here belongs to this walk alone and closes with it.
    let clock = budget
    let ownClock: Budget | null = null
    const queue: string[] = []
    let wakeConsumer: (() => void) | null = null
    let resumeWalk: (() => void) | null = null
    let rejectWalk: ((reason: unknown) => void) | null = null
    let abandoned = false
    let finished = false
    let failure: unknown = null
    let failed = false

    // Field order matches the `Out` declaration, and `renderToString`'s. A document render has both
    // alive at once — this walk, plus a string `Out` per deferred boundary — and `emit` reads both
    // per node, so two orders here would be two hidden classes under every one of those reads.
    const out: Out = {
        text: '',
        flush(): Promise<void> | null {
            if (out.text !== '') {
                queue.push(out.text)
                out.text = ''
            }
            const wake = wakeConsumer
            wakeConsumer = null
            if (wake !== null) wake()
            if (abandoned) return Promise.reject(ABANDONED)
            // Nothing to wait FOR when the consumer is not behind. The chunk is already queued and
            // the consumer already woken, so parking here bought a promise and a full round trip per
            // row of a streamed list to learn that it could carry on. Back-pressure starts where it
            // is actually needed: one unread chunk is slack, two is a consumer falling behind, and
            // the walk parks then — so the queue is bounded at two either way.
            if (queue.length <= 1) return null
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

    /** Declared return type for the reason `takeResume` has one: the only writer is `walk`. */
    function ownedClock(): Budget | null {
        return ownClock
    }

    /** Unwind a walk parked on something nobody is waiting for any more. Set the flag AND reject. */
    function abandon(): void {
        abandoned = true
        const reject = takeReject()
        if (reject !== null) reject(ABANDONED)
    }

    async function walk(): Promise<void> {
        try {
            const waiting = emit(node, context, out)
            if (waiting !== null) {
                // Read on the branch that actually waited: a page with no promise in it cannot run
                // out of wall clock, so a render that never suspends never even asks. Undeclared,
                // the walk is awaited exactly as it was before there was a budget at all — no timer,
                // no race, and no second promise per render to learn that nobody set one.
                if (clock === null) {
                    const limit = renderBudget()
                    if (limit !== NO_LIMIT) {
                        ownClock = new Budget(limit)
                        clock = ownClock
                    }
                }
                if (clock === null) await waiting
                else await clock.race(waiting)
            }
        } catch (error) {
            if (error !== ABANDONED) {
                failed = true
                failure = error
                // The walk is still parked somewhere past the deadline, and abandoning it is what
                // unwinds it — the same path a consumer breaking out of `for await` takes, so an
                // infinite source inside it gets its `return()` rather than running on under a
                // response nobody is reading. Everything already written still goes out: the status
                // line left long ago, and a truncated body is all HTTP itself has left to say.
                abandon()
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
            abandon()
            ownedClock()?.close()
        }
        await walking
        if (failed) throw failure
    })()
}

/** The walk as a stream of chunks — one per suspension, and one per buffer-full of markup. */
export function render(node: Renderable, options?: RenderOptions): AsyncGenerator<string> {
    return stream(node, contextFor(options), null)
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
    const out: Out = { text: '', flush: null }
    const waiting = emit(node, contextFor(options), out)
    if (waiting !== null) await waiting
    return out.text
}

export function toStream(node: Renderable, options?: RenderOptions): ReadableStream<Uint8Array> {
    return bytes(stream(node, contextFor(options), null))
}

/**
 * A walk's chunks as a byte stream, in the caller scope and holding it until the body is done.
 *
 * Both halves are the whole reason this is not four lines at each call site, and they answer
 * different failures. A handler answering with a stream RETURNS before a byte is written, so `serve`
 * tears the scope down on the way out and a `memo` read by the third chunk finds a cache cleared
 * under it — the right answer, built a second time, with nothing to say so. That is the HOLD.
 *
 * The BIND is for where the walk starts. `stream` is already running by the time it gets here, and an
 * `await` carries the scope through it — but `renderDocument` is an async generator, so its body does
 * not run until the first `next()`, which is a `pull` the runtime calls from its own context. Over a
 * real socket that walk then begins outside the request and `outlet()` renders an empty slot.
 *
 * Pumped rather than handed to `heldStream` on the way out: the walk IS the source, so this is ONE
 * stream where wrapping would be two — and a page is the hottest body abide writes. `heldPump` marks
 * what it builds, so `page()` can still ask any body it is handed whether it already holds.
 */
function bytes(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
    return heldPump(
        () => chunks.next(),
        // A generator's `finally` is the app's own cleanup, and `heldPump` calls this bound — so it
        // sees the caller the walk was opened for rather than whoever cancelled.
        (reason) => void chunks.return?.(reason as never),
        holdScope(),
    )
}

/**
 * A whole document: shell, body streamed in order, then out-of-order patches as they resolve.
 *
 * The first argument is either the app's own document — `shell(html)`, cut at the `<slot></slot>`
 * where the page goes — or just its `<head>`, which is abide's own document wrapped around it. The
 * two are one path: a head string IS a shell, and `shellAround` is where it becomes one.
 */
export async function* renderDocument(
    document: string | Shell,
    body: () => Renderable,
    options?: RenderOptions,
): AsyncGenerator<string> {
    const parts = typeof document === 'string' ? shellAround(document) : document
    const deferrals = { nextId: 0, deferred: [] as Deferred[] }
    const context: RenderContext = { hydratable: options?.hydratable === true, document: deferrals }
    // ONE clock for the whole document. A deferred block does not hold the walk — it
    // defers into the drain below — so a budget that only reached the walk would miss the very case
    // it exists for: the page that suspends. Read here rather than inside `stream`, because this is
    // where the render begins; the clock arms itself on the first phase that actually waits, so a
    // document with nothing to await still costs no timer.
    const limit = renderBudget()
    const clock = limit === NO_LIMIT ? null : new Budget(limit)
    try {
        // Every scoped `<style>` registers at MODULE scope, so by the time a render starts, every
        // component that was imported has already declared its rules — which is why the whole sheet
        // can go out in the shell without tracking what this particular render reached. Each block
        // carries its scope name, which stops the client appending a second copy of every one.
        // Read ONCE for the whole document rather than per patch: it is the same value every time,
        // and a render outside a request — the demo card renders through this substrate in a browser
        // — has no scope to read it from and nothing asking it to.
        const stamp = isServing() ? nonce() : null
        // Opened before a byte of the body, because the first read of an rpc happens inside the walk
        // below and there has to be somewhere for it to land.
        openSeeding()
        yield `${parts.head}${styleTags(stamp)}${parts.open}`
        yield* stream(body(), context, clock)
        yield* drain(deferrals, clock, false, stamp)
        // AFTER the drain, and OUTSIDE the hydration root — two separate requirements that both put
        // it exactly here. After the drain, because a `{#if x.pending()}` region resolves its reads
        // long after the shell is on the wire, so a block written beside the styles would carry only
        // the slots that were already warm. Outside `close`, because everything between `open` and
        // `close` is what the client ADOPTS: written inside, this is an extra child the client's own
        // render never produces, and it survived only because hydration happened to read it before
        // discarding it — leaving a stray script in the content for anyone running no scripts.
        yield parts.close
        yield seeds(stamp)
        yield parts.tail
    } finally {
        clock?.close()
    }
}

/** What this render resolved, as the block the client reads it out of. Empty when nothing did. */
function seeds(stamp: string | null): string {
    const collected = closeSeeding()
    if (collected === null) return ''
    const table: Record<string, unknown> = {}
    for (const [key, value] of collected) table[key] = value
    // A value that will not serialise is one the client could not have been handed anyway — a
    // `Map`, a class instance with a cycle. The render has already succeeded by here and the markup
    // is on the wire, so the answer is to seed nothing rather than to fail a page over its own
    // optimisation: every slot then loads the way it did before any of this existed.
    try {
        return seedScript(JSON.stringify(table), stamp)
    } catch {
        return ''
    }
}

/**
 * The same document as ONE string, with nothing left in it to run.
 *
 * `renderDocument` defers a suspended subtree into a `<template>` and a two-line script that puts it
 * back, which is the right answer for a browser and no answer at all for a reader that does not run
 * scripts: an email client, a PDF renderer, a fixture holding an expected document. There the markup
 * has to be complete when the string is.
 *
 * So this is `renderToString`'s context — no `document`, which is what makes a block await INLINE,
 * in document order — with the shell around it. The shell half is `renderDocument`'s, down to the
 * nonce on the styles: a policy that reached this render reaches its `<style>` blocks too. Nothing
 * else here can emit a script, so there is no patch script to carry one.
 *
 * The arguments are `renderToString`'s rather than `renderDocument`'s, and both differences are the
 * same fact: this is a plain async function, so the whole walk happens before it returns. There is
 * nothing to delay, so `body` is the NODE — a thunk is one arm of `Renderable` anyway, so `() => …`
 * still works and is no longer a wrapper the caller has to write. `renderDocument` needs the thunk
 * because it is a generator: its body does not run until the first `next()`, which is a pull the
 * runtime makes from its own context, and a tree built before that is a tree built outside the
 * request. And `document` trails with a default, because the caller with no document of its own —
 * the mail, the fixture — is the one this exists for.
 *
 * That default, and any head string, is abide's own document around it. `shell(app.html)` is the
 * other form and rarely what mail wants: it leaves the `<slot>` tags in the markup, because they are
 * the container a hydrating client adopts, and there is no client here to adopt anything.
 */
export async function renderDocumentToString(
    body: Renderable,
    document: string | Shell = '',
    options?: RenderOptions,
): Promise<string> {
    const parts = typeof document === 'string' ? shellAround(document) : document
    const stamp = isServing() ? nonce() : null
    const markup = await renderToString(body, options)
    return `${parts.head}${styleTags(stamp)}${parts.open}${markup}${parts.close}${parts.tail}`
}

/**
 * A page WITHOUT its document — the outlet alone, streamed the same way, for a client that is already
 * looking at the shell.
 *
 * The same walk and the same deferral as `renderDocument`, and that is the point: a navigation gets
 * out-of-order streaming rather than a second-class render that awaits everything inline. Without
 * this, a block under a fragment falls to `emitAwaited`, which awaits IN DOCUMENT ORDER — so
 * a fast panel below a slow one waits for the slow one, and so does every static byte beneath it,
 * neither of which was ever waiting on data of its own.
 *
 * Two things differ from the document form, and both are forced by who does the parsing. There is no
 * `PATCH_SCRIPT` and no `<script>` per patch, because a script the client injects does not execute;
 * the client swaps the placeholder itself. And every piece is followed by `PIECE_END`, because HTML
 * cannot be parsed halfway — the sentinel is what tells a reader that what it holds is a complete
 * tree it may parse now rather than a prefix of one.
 *
 * The seeds go LAST, which a document cannot do and this can: a document's client hydrates as the
 * parser reaches the markup, so its block has to be written before the reads that consume it. A
 * navigation commits only once the whole stream has been read — `router.ts`'s `enter` awaits
 * `complete` before `commit`, and `commit` is what runs the page's view on this side — so a block
 * written after the drain still lands before the first client read. That is what lets the DEFERRED
 * half be seeded too: a panel whose load settles during the drain is in this table, so the arriving
 * page paints its settled arm rather than a `pending()` placeholder over a value already on screen.
 */
export async function* renderFragment(
    body: () => Renderable,
    options?: RenderOptions,
): AsyncGenerator<string> {
    const deferrals = { nextId: 0, deferred: [] as Deferred[] }
    const context: RenderContext = { hydratable: options?.hydratable === true, document: deferrals }
    const limit = renderBudget()
    const clock = limit === NO_LIMIT ? null : new Budget(limit)
    try {
        openSeeding()
        yield* stream(body(), context, clock)
        // The in-order pass is a complete tree the moment it ends, and it ends without waiting for a
        // single load — every deferred block in it. So this sentinel is the whole latency win:
        // the client may paint everything above, below and between the panels right here.
        yield PIECE_END
        yield* drain(deferrals, clock, true, null)
        // No nonce: this block is never inserted. The client parses it out of a `<template>` and
        // reads its text, so there is no element for a policy to evaluate — and `application/json`
        // would not execute even if there were.
        const seeded = seeds(null)
        if (seeded !== '') yield `${seeded}${PIECE_END}`
    } finally {
        clock?.close()
    }
}

/** The same fragment as a `ReadableStream`, which is what a navigation is answered with. */
export function fragmentToStream(
    body: () => Renderable,
    options?: RenderOptions,
): ReadableStream<Uint8Array> {
    return bytes(renderFragment(body, options))
}

/**
 * Every deferred subtree, in the order they SETTLE rather than the order they were declared.
 *
 * Shared by the two forms above because the racing is the same problem — what differs is only how a
 * patch is delivered, which is the `framed` flag. Two copies of this loop would be a document that
 * streams out of order and a fragment that quietly stopped.
 */
async function* drain(
    deferrals: DocumentContext,
    clock: Budget | null,
    framed: boolean,
    nonce: string | null,
): AsyncGenerator<string> {
    // The race carries the settled MARKUP, not the deferred: `ready.html` is settled by
    // definition once it wins, so awaiting it again would buy a microtask tick per subtree.
    // Each subtree subscribes ONCE, when it is taken, and pushes into `landed`. `Promise.race` over
    // the pending set instead attached a fresh reaction to every subtree still in flight on every
    // patch, and nothing detaches those — N deferrals cost N²/2 reaction records retained on the
    // promises.
    //
    // `d.html` cannot reject: `emitSuspend` builds it around a `try`, and a failed subtree settles as
    // a comment. So there is no rejection path to route through the queue.
    const landed: { id: number; text: string }[] = []
    let wake: (() => void) | null = null
    // The list is CLOSED before this is entered, so it is walked once and there is no cursor to
    // keep: the only `deferred.push` is `emitSuspend`'s, it happens only when `context.document` is
    // set, and a deferred subtree is rendered by `renderToString`, whose context always carries
    // `document: null`. A `suspend` nested inside a suspended subtree therefore awaits INLINE — it
    // delays its parent's patch rather than registering a patch of its own — and the walk this
    // drains has finished before the first yield here.
    let pending = deferrals.deferred.length
    for (const d of deferrals.deferred) {
        void d.html.then((text) => {
            landed.push({ id: d.id, text })
            const resume = wake
            wake = null
            resume?.()
        })
    }
    // The two-line patch script goes out ahead of the FIRST patch rather than in the shell, and
    // the guard is the whole point: a page that suspends nothing ships neither the script nor a
    // `<script>` node inside the slot a hydrating client adopts — where an unexpected element is
    // a mismatch and a rebuilt subtree. Nothing calls `$p` before a patch exists, so a yield here
    // is early enough, and the loop below then has no state to carry between turns.
    if (!framed && pending > 0) yield patchScript(nonce)
    while (pending > 0) {
        if (landed.length === 0) {
            const waiting = new Promise<void>((resolve) => {
                wake = resolve
            })
            // Nothing to abandon here, unlike the walk: a deferred subtree is an independent async
            // function with no handle to unwind, and a consumer breaking out of this loop already
            // leaves it running. What the budget ends is the RESPONSE. Raced per WAIT rather than
            // per patch, so a burst that has already landed is still written out under one check.
            if (clock === null) await waiting
            else await clock.race(waiting)
        }
        const ready = landed.shift() as { id: number; text: string }
        pending--
        const patch = `<template id="${patchId(ready.id)}">${ready.text}</template>`
        // A framed patch carries no script: the client is parsing this itself and would not run one.
        yield framed
            ? `${patch}${PIECE_END}`
            : `${patch}<script${nonceAttribute(nonce)}>$p(${ready.id})</script>`
    }
}

/**
 * The same document as a `ReadableStream`, so the response back-pressures.
 *
 * What `toStream` is to `render`, this is to `renderDocument` — one walk, three ways to consume it,
 * and the stream is the one a served page wants: a browser gets the head and starts fetching the
 * bundle while the body is still being written, and a slow consumer stops the walk rather than
 * filling a buffer with a document nobody is reading yet.
 */
export function documentToStream(
    document: string | Shell,
    body: () => Renderable,
    options?: RenderOptions,
): ReadableStream<Uint8Array> {
    return bytes(renderDocument(document, body, options))
}

// The principal, and the half only the server can supply. `identity` itself is on the isomorphic
// surface — asking is the same call anywhere — and it is re-exported here, straight from the module
// that defines it, because the handler writing a login is already importing `request()` and
// `cookies()` from this entry point.
export { type Identity, identity } from '$shared/identity.ts'
// The shape one line takes on the remote feed. The endpoint itself is `dispatch`'s — an app mounts
// that and gets `/__abide/logs` with it — but a reader of the feed needs the record to decode into.
// `Level` beside the record it is a field of. Not on `abide`, because no call there takes or returns
// one — `log.warning(...)` is a method per level rather than a level-taking call.
export type { Level, LogRecord } from '$shared/log.ts'
// The other two facts DERIVED from the environment rather than named by it. They are not `config()`
// fields — a field there is a variable, and these are conclusions: `ABIDE_APP_NAME` is the variable,
// and this is it resolved against the nearest package.json and then against `abide`.
export { appName } from '$shared/log.ts'
// Where this app may write, which is a question about the PROCESS rather than about a caller — so it
// needs no `serve`, and it lives with the other thing that needs a filesystem to answer.
export { appDataDir, appVersion } from './app.ts'
// What the process was TOLD: the typed environment, with the app's own defaults under it. The one
// ambient with no wire face — half the document is a signing key — so unlike `health()` and
// `identity()` there is no isomorphic half and no endpoint to make one out of.
export {
    type Config,
    type ConfigDefaults,
    type ConfigOptions,
    type Configured,
    config,
    type Env,
    onConfig,
} from './config.ts'
// The one security header abide can help with, because the half an app cannot write — authorising
// abide's OWN inline script and styles — is the half only abide knows. Opt-in: `middleware = [csp()]`.
export { csp } from './csp.ts'
// The app's own account of whether it is working. `health()` itself is on the isomorphic surface —
// asking is the same call anywhere — and this is the half only the app being asked about can supply.
export { type HealthReporter, onHealth } from './health.ts'
export { type IdentityResolver, onIdentity } from './identity.ts'
// What every renderer here takes. `RenderContext` stays internal: it is the walk's own state, and
// its `document` field is typed by a `DocumentContext` no caller can name.
export type { RenderOptions } from './internal/emit.ts'
// The process's own lifecycle, and the request pipeline the four hooks hang off. Registrations for
// the same reason `onHealth` is one — the half of the CLI that boots reads these off an app's
// exports and hands each to the function of the same name.
export {
    boot,
    type ErrorHook,
    handle,
    type Middleware,
    middleware,
    onError,
    onStart,
    onStop,
    type Route,
    type StartHook,
    type StopHook,
    shutdown,
} from './lifecycle.ts'
// The one part of routing that is NOT isomorphic, because a filesystem is not. What it hands back is
// an ordinary route table, and `routes()` takes the same one on either side.
export { pages } from './pages.ts'
// The transport seam: what a handler is DECLARED as, and the one entry point that serves it. Here
// rather than on the isomorphic surface because a handler's body must not reach a browser — the
// compiler elides the whole module, and `abide` carries the stub's half.
export { dispatch, endpoints, register, registered, websocket } from './registry.ts'
// What an app's own route answers with. Server-side because a `Response` is: the browser lane reads
// one, it never builds one.
export {
    type DataFailure,
    error,
    type Failed,
    type Failure,
    type FailureOptions,
    HttpError,
    json,
    jsonl,
    page,
    type RedirectStatus,
    redirect,
    sse,
    type TypedOptions,
} from './responses.ts'
export {
    DELETE,
    GET,
    PATCH,
    POST,
    PUT,
    type RpcMiddleware,
    type RpcOptions,
    type RpcSchemas,
    type SocketEvent,
    type SocketMiddleware,
    type SocketOptions,
    socket,
} from './rpc.ts'
// The server that is listening, as an ambient. A process fact rather than a caller's, like
// `appDataDir` above it — Bun hands the instance to `fetch(request, self)` and nowhere else, and this
// is what stops that being threaded through every layer under it.
export { type RunningServer, server } from './running.ts'
// The declared shape of what crosses a transport. Server-side because an option cannot cross the
// wire: a schema is checked where the handler is, and the browser lane gets the address alone.
export {
    type EndpointShape,
    type Issue,
    type JsonSchema,
    type JsonType,
    SCHEMA_ERROR,
    type Schema,
    type SchemaRefusal,
    type Shapes,
    type StandardSchemaV1,
    validateJson,
} from './schema.ts'
// The caller scope and its ambients. `serve` is what makes every module-level `memo` per-request.
// `heldStream` is the one piece of it an app reaches for directly: abide holds what abide builds, and
// a body written by hand takes its own hold with the same call the helpers make.
export { bag, cookies, heldStream, isServing, nonce, request, serve, type Trace, trace } from './scopes.ts'
// The document an app's pages are served IN. Here rather than in the CLI that reads `app.html`,
// because what a shell IS belongs to the renderer that fills it — and an app rendering its own
// document takes the same `Shell` `abide start` does.
export { type Shell, shell } from './shell.ts'
// The sheet every `adopt()` registered, as `<style>` tags for `<head>`. On `abide/server` and not on
// `abide`, because writing a stylesheet as markup is something only a server render does — the client
// lane adopts into the document instead, and never spells this.
export { styleTags } from '$shared/styles.ts'
