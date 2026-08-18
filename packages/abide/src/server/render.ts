// The SSR walk, and the eight faces over it.
//
// Split out of `index.ts` so that file can be what `abide/server` means — a curated list of names an
// app types — rather than a 1,200-line implementation with a re-export block at the bottom. Only one
// of the eight is public: `render`, the async generator. A caller wanting a string drains it, and the
// other seven are on `abide/server/internal` because `abide start` is what calls them.
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
    caughtArm,
    cellProps,
    Component,
    escape,
    isAttributeName,
    isKeyed,
    isTemplate,
    type Keyed,
    Raw,
    Streamed,
    nonceAttribute,
    settledArms,
    settledBoundary,
    type TemplateResult,
} from '#shared/html.ts'
import { abideLog } from '#shared/log.ts'
import {
    forgetProbedLoad,
    hasProbedLoad,
    isPending,
    type Pending,
    probedLoad,
    retryable,
    retryableCall,
    settledOf,
} from '#shared/internal/graph.ts'
import {
    closeMarker,
    OPEN_MARKER,
    PIECE_END,
    PLACEHOLDER_TAG,
    patchId,
    placeholderId,
} from '#shared/internal/MARKERS.ts'
import { isAsyncIterable, isThenable, messageOf } from '#shared/internal/probes.ts'
import { seedScript } from '#shared/internal/seed.ts'
import { planOf, unwrap } from '#shared/internal/slots.ts'
import { arm, NO_LIMIT, timeoutError } from '#shared/internal/timers.ts'
// Re-exported below as well: `<head>` is the only place a sheet is written as markup, so this is a
// SERVER name that happened to live in `#shared` because `adopt()` fills the registry it reads.
import { styleTags } from '#shared/styles.ts'
import {
    attribute,
    type Deferred,
    type DocumentContext,
    IN_PLACEHOLDER,
    PLAIN,
    patchScript,
    type RenderContext,
} from './internal/emit.ts'
// Imported for its side effect as much as for `appDataDir`: it installs the package.json fallback
// under `ABIDE_APP_NAME`, which is what names `log`'s default channel. Importing `abide/server` at
// all is the signal that there is a filesystem to ask.
import './app.ts'
import { knobOf } from './config.ts'
import { closeSeeding, heldPump, holdScope, isServing, nonce, openSeeding } from './scopes.ts'
import { askedShell, type Shell, shellAround } from './shell.ts'

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
    /**
     * The markup written before each HOLE, and the holes themselves — `null` in a slot is a hole that
     * has not filled. Null itself until a region takes one, which is every render with no wait in it.
     *
     * A hole is how a render stops costing the SUM of its waits. A region that has to wait used to
     * hold the walk, so the loads in every slot after it did not begin until it settled — three
     * independent 60ms loads cost 183ms. Written into a buffer of its own and spliced back at the
     * position it left, the walk carries straight on and starts them, and the same three cost 62ms.
     */
    segments: (string | null)[] | null
    /** One per hole, settled when that hole's markup is in `segments`. */
    fills: Promise<void>[] | null
    /**
     * How many segments have gone to the consumer. A STREAM may only be given the run of segments up
     * to the first unfilled hole — bytes leave in document order however the holes settle, which is
     * what lets this lane take one at all.
     */
    sent: number
    /**
     * Bytes written but not yet sendable, because a hole in front of them is still open. Kept as a
     * running count rather than summed on demand: it is read once per WAIT to decide whether taking
     * another hole is affordable, and walking the segment list for that would be per-wait work.
     */
    held: number
    /**
     * The holes not yet filled, so the cap can SPILL them — see `spill`. Null until one is taken.
     *
     * Patching the region the cap was reached AT would not bound anything: the bytes are held behind
     * the EARLIEST open hole, and that one is still open. What has to be given up is every hole at
     * once, which is why this list exists rather than a count.
     */
    open: Hole[] | null
}

/** One position held open behind the walk: where it goes, what fills it, and whether a spill took it. */
interface Hole {
    at: number
    markup: Promise<string>
    patched: boolean
    /**
     * May the cap give this one up?
     *
     * True for a REGION — markup that stands on its own between two nodes, which is what a placeholder
     * element can stand in for. False for an ATTRIBUTE or a spread: what those write is ` class="…"`
     * inside a start tag that is still open, so a placeholder there reads `<div<slot-s></slot-s>>`,
     * which is not markup and has no element for the patch to land in. Such a hole is a buffer segment
     * and nothing more — it still holds, and that is the one thing the cap cannot buy its way out of.
     */
    spillable: boolean
}

/**
 * An empty buffer.
 *
 * ONE literal, which is what makes the shape rule hold by construction rather than by three comments
 * asking a reader to check field order across three sites. A document render has two `Out`s alive at
 * once — this walk, plus a string one per deferred boundary — and `emit` reads both per node, so two
 * orders would be two hidden classes under every one of those reads. `stream` builds its own because
 * its `flush` is a method rather than a field assigned after.
 */
function newOut(): Out {
    return { text: '', flush: null, segments: null, fills: null, sent: 0, held: 0, open: null }
}

/** `null` means the node is fully written; a promise means the rest of it will be. */
type Rest = Promise<void> | null

/** `Promise.all` hands back an array, and every caller here wants the settle rather than the values. */
function nothing(): void {}

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

/**
 * How many bytes a STREAMING walk may hold behind an open hole before it SPILLS them — see `spill`.
 *
 * Everything written past an unfilled hole is markup a consumer cannot be given yet, and the walk
 * fills that at CPU speed rather than at the load's: measured behind a 300ms load, a megabyte of
 * document was held 1.6ms after the first hole was taken. That is also why the cap is bytes and not
 * a duration — the two quantities are decoupled, and a timer long enough to be worth having would
 * let the whole document through every time.
 *
 * Eight chunks: enough that a page's panels overlap, small enough that the ceiling is a chunk count.
 */
const HOLD_LIMIT = HIGH_WATER * 8

/**
 * May this position be left open? A string render always can — its buffer IS its output, so a hole
 * costs it nothing it was not going to hold anyway — and a stream can until the held bytes reach the
 * cap.
 */
function holds(out: Out): boolean {
    return out.flush === null || out.held + out.text.length < HOLD_LIMIT
}

/**
 * A branch that is about to wait: into a hole where the walk can carry on past it, in place where it
 * cannot.
 *
 * The six waiting branches are all one shape — an async function writing into an `Out` — so the fork
 * is here rather than six times over. One closure per WAIT, which is the branch that was about to
 * cost a load anyway.
 *
 * Over the cap, the holes are SPILLED rather than the walk stopped, which is what keeps a big page's
 * loads in flight together. With nowhere to patch — `render()`, `toStream()` — there is nothing to
 * spill INTO, so that lane blocks exactly as it did before any of this.
 */
function waits(out: Out, run: (into: Out) => Promise<void>, context: RenderContext): Rest {
    if (!holds(out) && context.document !== null) spill(out, context.document)
    return holds(out) ? hole(out, run) : run(out)
}

/**
 * Give up every open hole: each becomes a PLACEHOLDER now and a patch when it lands.
 *
 * This is what the cap does instead of stopping the walk. Blocking bounded the buffer by refusing to
 * write more, at the price of the loads after it starting one at a time again — 224ms against 161ms
 * on a megabyte page behind four loads. Spilling bounds it by making the held bytes SENDABLE: the
 * hole's markup no longer has to arrive in document order, because it arrives as a `<template>` and
 * a `$p` call instead, exactly as a `{#if x.pending()}` region does.
 *
 * The trade is real and belongs to the reader rather than to the server: a patched region needs
 * JAVASCRIPT to appear, so a crawler sees the placeholder. It is announced for that reason — a page
 * that crossed the cap is a page whose fidelity changed, and the size it happens at is not something
 * an author can see in their own source.
 */
function spill(out: Out, document: DocumentContext): void {
    const open = out.open
    if (open === null || open.length === 0) return
    const segments = out.segments as (string | null)[]
    // What the cap may not have — see `Hole.spillable`. Carried over rather than dropped, so the fill
    // that lands later still finds its entry to `take`.
    const kept: Hole[] = []
    let given = 0
    for (let i = 0; i < open.length; i++) {
        const entry = open[i] as Hole
        if (!entry.spillable) {
            kept.push(entry)
            continue
        }
        if (entry.patched) continue
        entry.patched = true
        given++
        const id = document.nextId++
        document.deferred.push({
            id,
            html: entry.markup.then(
                (text) => text,
                (error: unknown) => deferralFailed(id, error, 'threw after the walk gave up its hole'),
            ),
        })
        const placeholder = `<${PLACEHOLDER_TAG} id="${placeholderId(id)}"></${PLACEHOLDER_TAG}>`
        segments[entry.at] = placeholder
        out.held += placeholder.length
    }
    open.length = 0
    for (let i = 0; i < kept.length; i++) open.push(kept[i] as Hole)
    // Nothing was given up, so nothing became sendable and there is no trade to announce: the walk
    // is behind a hole it may not spill and blocks exactly as it did before any of this.
    if (given === 0) return
    renderLog.warning(
        `a render passed ${HOLD_LIMIT} held bytes and patched ${given} region(s) instead of ` +
            'blocking — that markup now needs javascript to appear',
    )
    // Everything is sendable now, so hand it over: the point of spilling is the bytes LEAVING, and
    // the walk's own next `paused` is where back-pressure is applied.
    flushFilled(out)
}

/** Hand over what a fill or a spill just made sendable, without parking on the consumer. */
function flushFilled(out: Out): void {
    if (out.flush === null) return
    const waiting = out.flush()
    // The WALK applies back-pressure; this is a fill landing beside it, so it neither parks nor
    // carries the abandonment its own flush may answer with.
    if (waiting !== null) void waiting.catch(() => {})
}

/**
 * A branch that STREAMS rather than one that waits once — `{#for await}` and a bare async iterable.
 *
 * These may take a hole only where nothing is consuming incrementally, and the distinction is not a
 * refinement: a hole hands over the region's markup when it is COMPLETE, so a source arriving a row
 * at a time collapses into one chunk at the end — eight rows, eight chunks, became three — and an
 * INFINITE source never completes at all, so a channel in a slot hung the render outright. A source's
 * bytes ARE the stream, which is why they stay in the walk's own buffer wherever there is a consumer.
 */
function streams(out: Out, run: (into: Out) => Promise<void>): Rest {
    return out.flush === null ? hole(out, run) : run(out)
}

/**
 * Reserve this position, hand `run` a buffer of its own, and return as though the node were written.
 *
 * The walk goes on to the next sibling — which is the whole point, since that is where the loads
 * that would otherwise have started one at a time live. `assembled` joins a string render back up;
 * `sendable` is what lets a stream give away the part in front of a hole while it is still open.
 */
function hole(out: Out, run: (into: Out) => Promise<void>, spillable = true): Rest {
    let segments = out.segments
    if (segments === null) {
        segments = []
        out.segments = segments
    }
    let fills = out.fills
    if (fills === null) {
        fills = []
        out.fills = fills
    }
    // Only a STREAM keeps this list: `spill` is its one reader, and `holds` is unconditionally true
    // when `flush` is null, so no string render can reach it. Skipping it there is not a micro-saving
    // — `take` is an `indexOf` plus a `splice` per fill, so a thousand awaiting rows into one buffer
    // walked half a million entries to maintain a list nothing was able to ask for.
    let open = out.open
    if (open === null && out.flush !== null) {
        open = []
        out.open = open
    }
    out.held += out.text.length
    segments.push(out.text)
    out.text = ''
    const at = segments.length
    segments.push(null)
    const into = newOut()
    // The region's MARKUP, which is what a spill hands to the drain — so the two endings share one
    // run of the body rather than the walk having to choose between them up front.
    const markup = run(into).then(() => assembled(into))
    const entry: Hole = { at, markup, patched: false, spillable }
    if (open !== null) open.push(entry)
    fills.push(
        markup.then(
            (text) => {
                // Spilled while it was in flight: the placeholder is already on the wire and this
                // markup belongs to the patch, not to the segment it used to own.
                if (entry.patched) return
                if (open !== null) take(open, entry)
                ;(segments as (string | null)[])[at] = text
                out.held += text.length
                // A stream may now be able to give away everything up to the NEXT hole, and nothing
                // else will ask: the walk is past this position and may already have finished.
                flushFilled(out)
            },
            (error: unknown) => {
                // A patched region reports its own failure through `deferralFailed`. An open one is
                // still part of this walk, and fails it exactly as blocking there did.
                if (entry.patched) return
                if (open !== null) take(open, entry)
                throw error
            },
        ),
    )
    return null
}

/** Drop a hole that filled on its own, so a later spill has only the ones still open to give up. */
function take(open: Hole[], entry: Hole): void {
    const at = open.indexOf(entry)
    if (at !== -1) open.splice(at, 1)
}

/** The buffer as one string, once every hole in it is filled. */
async function assembled(out: Out): Promise<string> {
    const fills = out.fills
    if (fills === null) return out.text
    // THE COLLAPSE: every hole was opened before the walk carried on past it, so the loads under all
    // of them are in flight together and this waits out the longest rather than their sum.
    await Promise.all(fills)
    return `${(out.segments as string[]).join('')}${out.text}`
}

/**
 * Everything the consumer may have, into `queue`: the run of filled segments from where the last one
 * stopped, and the tail only once no hole is left open in front of it.
 *
 * The segment list is emptied the moment it is fully sent, so a page whose holes fill as it goes
 * keeps no list at all — and the common streaming walk, which takes none, never allocates one.
 */
function sendable(out: Out, queue: string[]): void {
    const segments = out.segments
    if (segments !== null) {
        let at = out.sent
        while (at < segments.length) {
            // Cast for the INDEX, not for the value: `at < segments.length` is the bound, and the
            // checker's `| undefined` for a read inside it is what the loop condition already ruled out.
            const piece = segments[at] as string | null
            if (piece === null) break
            if (piece !== '') {
                queue.push(piece)
                out.held -= piece.length
            }
            at++
        }
        out.sent = at
        // A hole is still open, so the tail behind it is not the consumer's yet.
        if (at < segments.length) return
        segments.length = 0
        out.sent = 0
    }
    if (out.text !== '') {
        queue.push(out.text)
        out.text = ''
    }
}

// --- the walk ----------------------------------------------------------------

function emit(node: Renderable, context: RenderContext, out: Out): Rest {
    // The typeof switch FIRST. A thousand-row table's slot values are strings and numbers, and the
    // brand checks below are seven prototype probes each of them would otherwise pay to get here.
    //
    // Which is why what a plain value renders as is spelled here rather than called: this is the
    // child-position half of the rule `#ui`'s `textOf` states, and the two lanes have to agree or a
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
        // blocks until the value lands; see `deferrable` in `#compiler`.
        //
        // That distinction is what an author is choosing between, and it is not a detail: a deferred
        // subtree arrives through a `<template>` and a two-line script, so it needs JAVASCRIPT. A
        // reader running none — a crawler, a mail client, `curl` — sees the placeholder forever.
        // Blocking is what puts the settled markup in the HTML, and the compact form is how it is
        // asked for. A render with nowhere to patch blocks either way.
        if (context.document !== null && node.branches.pending !== undefined) {
            return emitDeferred(node, context, out)
        }
        return waits(out, (into) => emitAwaited(node, context, into), context)
    }
    if (node instanceof Component) {
        // A snapshot has no instance to KEEP, so the call is the whole of the render — and it is a
        // producer like any other, since a `<script>` may read a load. The props are still wrapped:
        // what a component receives is cells on both sides, and a lane that handed the plain values
        // over would work for every compiled `.abide` file and break every hand-written one.
        return emitProduced(() => node.view(cellProps(node.props)) as Renderable, context, out)
    }
    if (node instanceof Boundary) return boundaryRegion(node, context, out)
    if (node instanceof Streamed) return streams(out, (into) => emitStreamed(node, context, into))
    if (isThenable(node)) return waits(out, (into) => emitPromise(node, context, into), context)
    if (isAsyncIterable(node)) return streams(out, (into) => emitAsyncIterable(node, context, into))

    out.text += escape(String(node))
    return null
}

/**
 * A `{#try}` as a REGION the walk owns, rather than one call it guarded.
 *
 * The boundary used to be `emitProduced(() => settledBoundary(node))`, which caught exactly what
 * running the BODY threw. That is a much smaller thing than it reads as: the body returns a
 * `TemplateResult` whose slots are thunks, so everything the region actually renders — a nested
 * component's setup, a block's thunk, a read of a load that rejected — happens after the body
 * returned and went straight past the catch. A `{#try}` around a `<slot/>` in a layout caught nothing
 * at all, silently, which is the worst shape a guard can have.
 *
 * So the region gets a BUFFER of its own and the walk runs inside it. A failure anywhere under here
 * — this call or a promise it left behind — discards what was written and emits the arm instead,
 * which is the only thing "catch anything inside it" can mean for markup: an arm can only replace a
 * region nobody has been given yet.
 *
 * THE COST, stated: the region no longer chunks progressively — it lands whole. That is already true
 * of every slow region (`waits` takes a hole, and a hole's `Out` has no `flush`), so it changes only a
 * boundary with nothing slow under it, and only up to `HOLD_LIMIT`, past which `spill` converts it to
 * a placeholder and a patch exactly as it does for anything else held.
 *
 * The sync arm allocates one `Out` and no promise, because the common `{#try}` has nothing to wait
 * for and an unconditional hole would cost a tick per region — per ROW for one inside a `{#for}`.
 */
function boundaryRegion(node: Boundary, context: RenderContext, out: Out): Rest {
    const inner = newOut()
    let rest: Rest
    try {
        // THROUGH `emitProduced`, into the private buffer — not `emit` over the body's result. The
        // difference is its probe bookkeeping, and it is load-bearing: a region that probes an
        // unlanded load with nowhere to patch must WAIT for the settle and re-run, and calling
        // `settledBoundary` outside that window left the probe unattributed, so a `{#try}` around an
        // `{#if x.pending()}` rendered the pending arm as the final answer. Caught by rendering the
        // same file with and without the boundary: `landed` became `waiting`.
        rest = emitProduced(() => settledBoundary(node) as Renderable, context, inner)
    } catch (error) {
        return emit(caughtArm(node, error) as Renderable, context, out)
    }
    // Nothing under it waits, so the region is already whole and goes in where it stands.
    if (rest === null && inner.fills === null) {
        out.text += inner.text
        return null
    }
    // Something does. A hole keeps the siblings in document order and puts the region under the same
    // cap everything else is under; catching INSIDE it is what stops a failure from becoming the
    // walk's, which is what it was before this.
    return hole(out, async (into) => {
        try {
            if (rest !== null) await rest
            into.text += inner.fills === null ? inner.text : await assembled(inner)
        } catch (error) {
            // The fills are settled before the arm is written, or a region that failed would go on
            // resolving into a buffer nothing reads and raise its rejections as unhandled.
            if (inner.fills !== null) await Promise.allSettled(inner.fills)
            const armed = emit(caughtArm(node, error) as Renderable, context, into)
            if (armed !== null) await armed
        }
    })
}

/**
 * A slot that waits INSIDE a start tag: into a hole where the walk can carry on past it, in place
 * where it cannot.
 *
 * `waits`'s shape for the four branches `waits` may not serve. The fork is the same one and the
 * difference is the whole reason this exists: a hole taken here is never offered to the cap, because
 * what an attribute writes is not a region a placeholder can stand in for — see `Hole.spillable`.
 * So there is no `spill` call and no `context`, and over the cap this blocks rather than patching.
 *
 * The two ways such a slot can arrive late — a read that signalled, and a thunk that handed back a
 * promise — end identically, which is why both arms of both cases come through here.
 */
function heldInTag(out: Out, run: (into: Out) => Promise<void>): Rest {
    return holds(out) ? hole(out, run, false) : run(out)
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
                    // A hole holds the ATTRIBUTE TEXT, which is the whole of what this slot writes —
                    // so the element it belongs to, and every load in the slots after it, carry on
                    // rather than waiting behind one `class=${() => tone()}`.
                    const signal = error
                    const rest = heldInTag(out, async (into) => {
                        into.text += attribute(name, await awaitedProduce(signal, () => unwrap(value), into))
                    })
                    if (rest === null) continue
                    return then_(rest, () => emitTemplate(result, context, out, i + 1))
                }
                if (isThenable(produced)) {
                    // Awaited in place, the way a child slot's promise is. `attributeText` is
                    // `String(value)`, so this is the difference between the value and the text
                    // `[object Promise]` — and the client binds the settled value either way, so
                    // without it the two lanes disagreed about the same attribute.
                    //
                    // `Promise.resolve` for the TYPE, not for a wrap: a native promise comes straight
                    // back out of it, and only a foreign thenable — which `isThenable` also admits —
                    // costs the adapter.
                    const settling = produced
                    const rest = heldInTag(out, async (into) => {
                        into.text += attribute(name, await settling)
                    })
                    if (rest === null) continue
                    return then_(rest, () => emitTemplate(result, context, out, i + 1))
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
                    // The attribute rule one hole kind over: what this slot writes is a run of
                    // attributes, and a run of attributes is a string like any other.
                    const signal = error
                    const rest = heldInTag(out, async (into) => {
                        writeSpread(await awaitedProduce(signal, () => unwrap(value), into), into)
                    })
                    if (rest === null) continue
                    return then_(rest, () => emitTemplate(result, context, out, i + 1))
                }
                if (isThenable(spread)) {
                    // The same rule as an attribute's, and it has to be: `{...await props}` compiles
                    // to an async thunk, so what arrives here IS a promise. `writeSpread` reads
                    // `Object.keys` off it, and a promise has none — so the whole spread rendered as
                    // nothing at all, silently, on a template that compiled clean.
                    const settling = spread
                    const rest = heldInTag(out, async (into) => {
                        writeSpread(await settling, into)
                    })
                    if (rest === null) continue
                    return then_(rest, () => emitTemplate(result, context, out, i + 1))
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
    // `Object.keys` rather than `for...in`: a spread is the one attribute source that is runtime data,
    // and a prototype the caller never wrote is not this element's attributes. The client walks its
    // own copy the same way, because a name only one lane writes is a hydration mismatch.
    const names = Object.keys(fields)
    for (let i = 0; i < names.length; i++) {
        const name = names[i] as string
        if (!isAttributeName(name)) continue
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
    if (failed) return settledArms(node.branches, true, settled) as Renderable
    try {
        return settledArms(node.branches, false, settled) as Renderable
    } catch (error) {
        if (isPending(error) || node.branches.catch === undefined) throw error
        return settledArms(node.branches, true, error) as Renderable
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
    forgetProbedLoad()
    try {
        produced = retryable(produce)
    } catch (error) {
        if (!isPending(error)) throw error
        const signal = error
        return waits(out, (into) => awaitPending(signal, produce, context, into), context)
    }
    // It PROBED a load that has not landed, so it had something to show and showed it: `produced` is
    // the placeholder, by the same rule an `{#if x.pending()}` arm is one — asking about a load is
    // having something to show while it runs. The difference is that nothing had to RECOGNISE the
    // spelling; a ternary, a negated probe and a `memo` over one all arrive here identically.
    //
    // A plain read does not reach this: it signals, and `awaitPending` above blocks as it always did.
    // Three answers, and `probedLoad` is asked for only where one of them consumes the promise it
    // BUILDS — an unawaited one is an unhandled rejection the moment the load fails.
    if (!context.placeholder && hasProbedLoad()) {
        // With nowhere to patch — `renderToString`, `renderDocumentToString` — the walk WAITS for the
        // SETTLE, so the markup is complete when it arrives. The placeholder is half an answer and it
        // is the half a reader running no scripts would keep forever. A walk that can patch asks for
        // the first chunk instead, which is a different moment only for a stream — see `probedLoad`.
        if (context.document !== null) {
            return emitProbed(produce, produced, probedLoad(true) as Promise<unknown>, context, out)
        }
        const settling = probedLoad(false) as Promise<unknown>
        return waits(out, (into) => awaitProbed(produce, settling, context, into), context)
    }
    return emit(produced, context, out)
}

/**
 * A region that probed an unlanded load, with nowhere to patch: WAIT for it and call the producer
 * again, so the markup is the settled one.
 *
 * The signal's `awaitPending` twin. Looping rather than recursing because the re-run may probe a
 * SECOND load — a region asking about two — and each pass waits for the one it just learned about.
 * Termination is the wall budget the whole walk is raced against, exactly as it is there.
 */
async function awaitProbed(
    produce: () => Renderable,
    settling: Promise<unknown>,
    context: RenderContext,
    out: Out,
): Promise<void> {
    const handed = handOver(out)
    if (handed !== null) await handed
    let waiting = settling
    let produced: Renderable
    for (;;) {
        try {
            await waiting
        } catch {
            // Waited out, not handled: a FAILED load is reported by the read in the re-run below,
            // with the author's own expression under it.
        }
        forgetProbedLoad()
        try {
            produced = retryable(produce)
        } catch (error) {
            if (!isPending(error)) throw error
            produced = (await awaitedProduce(error, produce, out)) as Renderable
            break
        }
        // The SETTLE again: this is the lane with nowhere to patch, so a stream is drained here.
        const again = probedLoad(false)
        if (again === null) break
        waiting = again
    }
    const rest = emit(produced, context, out)
    if (rest !== null) await rest
}

/**
 * A region that probed an unlanded load: send what it made, and patch in what it makes once the load
 * settles.
 *
 * The `{#if}` twin of this is `emitDeferred`, and the shape is simpler here because there are no
 * ARMS — one producer, called again. What it produces the second time is whatever its own probes
 * decide, so a region asking about two loads defers again on the second and patches twice.
 */
function emitProbed(
    produce: () => Renderable,
    placeholder: Renderable,
    settling: Promise<unknown>,
    context: RenderContext,
    out: Out,
): Rest {
    const id = defer(
        context,
        out,
        async () => {
            try {
                await settling
            } catch {
                // Waited out, not handled — the re-run below reports it from the author's own
                // expression, exactly as `awaitedProduce` leaves a failed load.
            }
            return produce
        },
        'threw while re-running its region',
    )
    // Already produced, so this emits the VALUE rather than calling the thunk a second time.
    return placeholderAround(out, id, () => emit(placeholder, IN_PLACEHOLDER, out))
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

/**
 * What a deferred subtree renders in: the same DOCUMENT, so deferral COMPOSES.
 *
 * It used to be `renderToString`'s context, which carries no document — so a deferring block inside a
 * deferred subtree awaited inline and delayed its parent's patch, and a page two regions deep held the
 * outer one until the inner load landed as well. With the document carried through, the inner block
 * registers a patch of its own: the outer region reaches the reader as soon as ITS load settles, and
 * the inner one follows. `drain` is what had to learn that its list can grow while it is being read.
 *
 * `placeholder` is false rather than carried: a placeholder renders through `IN_PLACEHOLDER` and never
 * reaches here, and a subtree that HAS patched is an ordinary region again.
 */
function deferredContext(context: RenderContext): RenderContext {
    return { hydratable: context.hydratable, document: context.document, placeholder: false }
}

/**
 * A subtree as a string, in a context of its own.
 *
 * The same six lines as `renderToString` and deliberately not a call to it: that would be one more
 * async frame, which is 160 ns on a JSC promise and 35% of what a small render costs — and this is
 * `renderToString`'s own inner loop, reached once per deferred subtree.
 */
async function intoString(node: Renderable, context: RenderContext): Promise<string> {
    const out = newOut()
    try {
        const waiting = emit(node, context, out)
        if (waiting !== null) await waiting
    } catch (error) {
        const fills = out.fills
        if (fills !== null) await Promise.allSettled(fills)
        throw error
    }
    if (out.fills === null) return out.text
    return assembled(out)
}

/** Abide's own channel for what a render could not say in the markup. Off unless `DEBUG` names it —
 *  except `error`, which the gate never swallows, and a subtree that failed with nowhere to report it
 *  is exactly what that exception is for. */
const renderLog = abideLog.channel('render')

/**
 * What a deferred subtree becomes when it cannot be rendered at all: markup that says so, and a line
 * on abide's own channel rather than only to a reader viewing source.
 *
 * EVERY path out of the block below returns through here or returns markup, because `drain` waits on
 * each subtree's `html` to SETTLE and attaches nothing to a rejection — one that rejects is one it
 * waits on forever, so the response never ends and the placeholder stays on screen. That is not a
 * leak to tidy: it is the whole page hung, over a failure that has already happened and could have
 * been reported. Measured before this existed: 284 bytes out and still streaming three seconds later.
 */
function deferralFailed(id: number, error: unknown, what: string): string {
    renderLog.error(`a deferred block ${what}: ${messageOf(error)}`)
    return `<!-- await ${id} failed: ${escape(String(error))} -->`
}

/**
 * Register a region as a PATCH: an id reserved now, markup pushed when the settle lands.
 *
 * ONE registration for the two deferring constructs, because the invariant above is one and it is
 * load-bearing: every path out of the body below returns markup and none of them rejects. A third
 * construct written beside these would have had to know that, and the two that exist each carried
 * their own copy of the rule.
 *
 * `awaited` is the whole of what the two differ by — it decides what the settle MEANS, and hands
 * back either the producer for the second pass or a string it would rather return outright, which is
 * how `{#await}` answers a failed load that named no `{:catch}`.
 */
function defer(
    context: RenderContext,
    out: Out,
    awaited: (id: number) => Promise<(() => Renderable) | string>,
    what: string,
): number {
    const document = context.document as DocumentContext
    const id = document.nextId++
    document.deferred.push({
        id,
        html: (async () => {
            try {
                const produce = await awaited(id)
                if (typeof produce === 'string') return produce
                let again: Renderable
                try {
                    again = retryable(produce)
                } catch (error) {
                    if (!isPending(error)) throw error
                    again = (await awaitedProduce(error, produce, out)) as Renderable
                }
                return await intoString(again, deferredContext(context))
            } catch (error) {
                return deferralFailed(id, error, what)
            }
        })(),
    })
    return id
}

/**
 * A block sent as a placeholder now and patched in when it settles.
 *
 * Reached only with a document to patch AND a pending arm to send — the dispatch above decides both,
 * so there is no guard to repeat here.
 */
function emitDeferred(node: Awaited, context: RenderContext, out: Out): Rest {
    // The operand itself, awaited below. It used to go through `started`, which reached a lazy
    // cell's `then` synchronously so the load was running before the pending arm asked about it —
    // `await` alone would not have, and the arm would have been told there was no load. The arm
    // starts it now, because a probe starts what it reports.
    const settling = node.value as PromiseLike<unknown>
    const id = defer(
        context,
        out,
        async (deferralId) => {
            let settled: unknown
            let failed = false
            try {
                settled = await settling
            } catch (error) {
                // The shell went out with the placeholder in it, so by the time this fails there is
                // nothing left to fail INTO. A `{:catch}` renders — which is the whole of what this
                // path gained over the `suspend` it replaced, where a failed load had no arm to reach
                // for. Without one it is a comment, because the author did not say what to show.
                if (node.branches.catch === undefined) {
                    return deferralFailed(deferralId, error, 'failed with no failure arm')
                }
                settled = error
                failed = true
            }
            // The arms are a producer here too, and this walk is the one that waits for them: a
            // deferred boundary renders through `renderToString`, which is handed what they MADE.
            // ONE thunk: written twice it was provably the same function allocated a second time on
            // the pending arm, which is the arm a load that signals always takes.
            return () => armsOf(node, settled, failed)
        },
        // The failure arm THREW, and for the compiled shape that is the ordinary outcome rather than
        // an exotic one: the compiler hands the same `{#if}` chain to all three branches, so on a
        // rejected load the chain falls past its own `pending()` test — false now — to an arm that
        // READS the cell, and the read throws the very failure the arm was called to report.
        // `{:else if x.error()}` is what asks instead.
        'threw while rendering its arms',
    )
    // Through `emitProduced` because the arm is a BODY like every other — a `{#if x.pending()}` chain
    // reads the very cell this block is waiting for.
    return placeholderAround(out, id, () =>
        emitProduced(node.branches.pending as () => Renderable, IN_PLACEHOLDER, out),
    )
}

/**
 * The placeholder's own tags, around whatever stands in the gap until the real region arrives.
 *
 * `produce` runs under `IN_PLACEHOLDER`, which is PLAIN: a placeholder is markup the client adopts as
 * one piece and replaces whole, so it must not defer again from inside itself.
 */
function placeholderAround(out: Out, id: number, produce: () => Rest): Rest {
    out.text += `<${PLACEHOLDER_TAG} id="${placeholderId(id)}">`
    const waiting = produce()
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
 * The wall budget for one streaming render.
 *
 * WALL rather than per slot: a slot holds the walk for as long as what it waits on takes, so a page
 * that waits thirty times has no single slot to blame for a response that never ends — and the whole
 * run is the only number a proxy in front of it is measuring anyway. One clock spans every PHASE of
 * a render, which is what makes a document's deferred half answer to it too.
 *
 * Here rather than in `#shared`'s `ceilings.ts` beside the other two: those bound what a PROCESS
 * remembers and are read from paths both lanes walk, while a streaming render only ever happens on
 * this side — a browser has no walk to budget and could not set the knob if it did.
 */
function renderBudget(): number {
    return knobOf('ABIDE_SSR_STREAM_BUDGET')
}

/** The clock a render races against, or `null` when nothing capped it — the three faces all ask this. */
function budgetClock(): Budget | null {
    const limit = renderBudget()
    return limit === NO_LIMIT ? null : new Budget(limit)
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
            // Not `out.text` directly: a hole in front of the tail means the tail is not sendable
            // yet, and document order is the one thing a stream cannot trade for latency.
            sendable(out, queue)
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
            // Already parked, so the WALK holds the resume handle and this caller is a fill or a
            // spill flushing beside it. Building a second promise here REPLACED the resolver the
            // consumer was about to call, and the walk then waited on one nobody held — a hang that
            // needs back-pressure and a late fill at the same time, so every render into a string
            // and every fast consumer missed it.
            if (resumeWalk !== null) return null
            return new Promise<void>((resolve, reject) => {
                resumeWalk = () => resolve()
                rejectWalk = reject
            })
        },
        segments: null,
        fills: null,
        sent: 0,
        held: 0,
        open: null,
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

    /**
     * `waiting`, under the wall clock — armed here, on the first phase that actually waits.
     *
     * A page with no promise in it cannot run out of wall clock, so a render that never suspends
     * never even asks. Named rather than written inline because a walk that took HOLES finishes with
     * work still outstanding, and the fills are a phase of the same render on the same clock.
     */
    function racing(waiting: Promise<void>): Promise<void> {
        if (clock === null) {
            ownClock = budgetClock()
            clock = ownClock
        }
        return clock === null ? waiting : clock.race(waiting)
    }

    async function walk(): Promise<void> {
        try {
            const waiting = emit(node, context, out)
            if (waiting !== null) await racing(waiting)
            // Every hole this walk left open. `emit` returns null once a region takes one, so on this
            // path the walk is DONE writing and what is left is the loads it did not stop for.
            const fills = out.fills
            if (fills !== null) await racing(Promise.all(fills).then(nothing))
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
        // A hole still open here is one the failure above unwound, and `sendable` stops in front of
        // it: a truncated body, in document order, which is what a torn-off response has always been.
        sendable(out, queue)
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

/**
 * What a render is asked for — the two decisions that are not the tree.
 *
 * Both default to OFF, and that is the same rule twice: a render pays for nothing it was not asked
 * for. Markup with no document around it is what a fragment, a mail body and a cached partial all
 * want, and markers nobody is going to adopt are two comments per slot for nothing.
 */
export interface RenderOptions {
    /**
     * The document to write around the markup. Absent or `false` is the markup alone.
     *
     * `true` is the app's OWN document — its `app.html`, the `lang` and the fonts and the meta tags in
     * it, with the build's stylesheets and every scoped `<style>` block in the head — which is the
     * same document `abide start` serves a page in. An app that wrote none gets abide's, so the ask
     * cannot fail.
     *
     * A STRING is one of your own, and it is a whole html file with a `<slot></slot>` in it rather
     * than a fragment or a head: the same shape `app.html` is, through the same `shell()`, so the
     * caller owns `<html>`, `<head>` and `<body>` and a file with nowhere to render is refused rather
     * than guessed at.
     */
    shell?: boolean | string
    /**
     * Write this render for a client to take over — the slot markers `hydrate()` adopts by, and, with
     * a `shell`, the `<script type="module">` that boots the client into it.
     *
     * Off by default, and the reason is what the client DOES: it mounts the pages route table at the
     * outlet, so on a path no page owns it renders that table's answer over the markup the route just
     * served. A document nobody is going to adopt should not carry the lane that would.
     */
    hydrate?: boolean
}

/**
 * The walk as a stream of chunks — one per suspension, and one per buffer-full of markup.
 *
 * The one public renderer, which is why the `shell` option lives here rather than being a face of its
 * own: a document is the same walk with the app's own text around it, and the shape a route reaches
 * for is `page(render(view, …))` either way.
 */
export function render(node: Renderable, options?: RenderOptions): AsyncGenerator<string> {
    const asked = options?.shell
    if (asked === undefined || asked === false) return stream(node, contextFor(options), null)
    // A thunk, because `renderDocument` is a generator whose body does not run until the first
    // `next()` — see there. The tree this closes over was already built by the caller, which is the
    // caller's own decision: `Renderable` has a thunk arm, so `render(() => view(), …)` moves the
    // build inside the walk for anybody who wants it there.
    return renderDocument(askedShell(asked, options.hydrate === true), () => node, options)
}

function contextFor(options: RenderOptions | undefined): RenderContext {
    if (options === undefined || options.hydrate !== true) return PLAIN
    return { hydratable: true, document: null, placeholder: false }
}

// Returning `Promise.resolve(out.text)` by hand instead of being `async` was tried and reverted:
// JSC gives an async function that never awaits the same 160 ns a bare `Promise.resolve` costs, so
// the hand-rolled form bought nothing and read worse. The fixed cost of a small render is the slot
// scan and the promise the caller awaits, not the shape of this function.
export async function renderToString(node: Renderable, options?: RenderOptions): Promise<string> {
    // No `flush`, so nothing in the walk can pause: a tree with no promises in it produces the whole
    // document without a single microtask, which is the entire reason `emit` is shaped this way. It
    // is also what lets a region that waits take a hole rather than hold the walk — see `Out`.
    const out = newOut()
    try {
        const waiting = emit(node, contextFor(options), out)
        if (waiting !== null) await waiting
    } catch (error) {
        // The walk failed with holes still open, and nothing is left to await them — an unawaited
        // rejection is an unhandled one. Settled here, and the walk's own failure is what is thrown.
        const fills = out.fills
        if (fills !== null) await Promise.allSettled(fills)
        throw error
    }
    // Asked here rather than inside `assembled`: a render with no hole in it is every render that
    // never waited, and calling one more async function to be told so costs it a promise and a tick —
    // 153 ns to 206 ns on a small template, which is 35% of what the whole render costs.
    if (out.fills === null) return out.text
    return assembled(out)
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
    const context: RenderContext = { hydratable: options?.hydrate === true, document: deferrals, placeholder: false }
    // ONE clock for the whole document. A deferred block does not hold the walk — it
    // defers into the drain below — so a budget that only reached the walk would miss the very case
    // it exists for: the page that suspends. Read here rather than inside `stream`, because this is
    // where the render begins; the clock arms itself on the first phase that actually waits, so a
    // document with nothing to await still costs no timer.
    const clock = budgetClock()
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
        // The root CLOSES here, before anything the drain writes. Everything between `open` and
        // `close` is what the client ADOPTS, and a patch is a `<template>` and a `<script>` that the
        // client's own render never produces — written inside, they are two extra children at the end
        // of the root, and the top-level part claiming that range mismatches and REBUILDS the whole
        // page it was handed correct markup for. Nothing needs them inside: the placeholder each one
        // replaces was written by the walk above, and `$p` finds it by id from anywhere in the
        // document. Every page whose content sits behind a deferred region hydrated this way.
        yield parts.close
        yield* drain(deferrals, clock, false, stamp)
        // AFTER the drain, because a `{#if x.pending()}` region resolves its reads long after the
        // shell is on the wire, so a block written beside the styles would carry only the slots that
        // were already warm. Outside the root for the reason the drain now is.
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
 * `patchScript` and no `<script>` per patch, because a script the client injects does not execute;
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
    const context: RenderContext = { hydratable: options?.hydrate === true, document: deferrals, placeholder: false }
    const clock = budgetClock()
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
    // `d.html` cannot reject: every path out of `emitDeferred`'s body returns markup, the settle and
    // the ARMS alike — see `deferralFailed`, which is what the loop below rests on. A rejection here
    // is a subtree this waits on forever, so `pending` never reaches zero and the response never ends.
    const landed: { id: number; text: string }[] = []
    let wake: (() => void) | null = null
    // The list GROWS while this reads it, which is what makes deferral compose: a deferred subtree
    // renders with the document carried through, so a block nested inside one registers a patch of
    // its own instead of holding its parent's until both loads have landed. A cursor rather than a
    // re-scan, and `take` is called after each patch is written — the nested block is pushed while
    // its parent's markup is being rendered, so it is always in the list by the time the parent lands.
    let taken = 0
    let pending = 0
    const take = (): void => {
        while (taken < deferrals.deferred.length) {
            const d = deferrals.deferred[taken++] as Deferred
            pending++
            void d.html.then((text) => {
                landed.push({ id: d.id, text })
                const resume = wake
                wake = null
                resume?.()
            })
        }
    }
    take()
    // The two-line patch script goes out ahead of the FIRST patch rather than in the shell, so a
    // page that suspends nothing ships no script at all. Nothing calls `$p` before a patch exists,
    // so a yield here is early enough, and the loop below then has no state to carry between turns.
    // Where all of this LANDS is `renderDocument`'s to decide, and it is after the hydration root
    // closes — a patch inside it is an extra child the client's own render never produces.
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
        // A block nested inside the subtree that just landed registered itself while that markup was
        // being rendered, so this is where it joins the loop. Its patch necessarily follows its
        // parent's — its load could not start until the parent's settled — which is the order the
        // client needs, since `$p` can only find a placeholder its parent's patch already put in the
        // document.
        take()
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
