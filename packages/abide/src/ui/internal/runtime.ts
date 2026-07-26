// Client runtime for `.abide` templates — the DOM + reactivity mechanics that emitted client code
// (and, today, the `renderClient.ts` interpreter) calls to build REAL DOM and wire fine-grained
// reactivity over the M1 state substrate. No virtual DOM, no diffing.
//
// This module is TS7-free (no `typescript` import, no `SyntaxKind`) and ships to the browser. It is
// the "AST → thunks/BlockFns → DOM" boundary: helpers accept pre-bound thunks (`read: () => unknown`)
// and `BlockFn`s rather than `(expression, scope)` pairs, so all expression evaluation stays in the
// caller.
//
// Cursor helpers (`template`/`firstChild`/`nextSibling`/`finalize`) are authored dual-mode-ready:
// Stage 1 (this PR) only exercises the clone path; Stage 2 reuses the identical calls to walk server
// DOM during hydration.

import { markIterableDone } from '../../shared/internal/iterableDone.ts'
import {
    closeEffectScope,
    disposeEffectScope,
    effect,
    openEffectScope,
    state,
    untrack,
} from '../../shared/internal/reactive.ts'
import { peekSettled } from '../../shared/internal/settledRead.ts'
import { streamTranscriptOf } from '../../shared/internal/streamTranscript.ts'
import { log } from '../../shared/log.ts'
import { HTML_ANCHOR } from './HTML_ANCHOR.ts'

// Re-export the reactive substrate so emitted client modules import everything from one place.
export { closeEffectScope, disposeEffectScope, effect, openEffectScope, state, untrack }

// Teardown callback: disposes an effect and/or removes created nodes. Guarded so double-calls and
// already-detached nodes are safe.
export type Disposer = () => void

// A block builder: mounts content into `parent` (before `anchor`, or appended when null) and returns
// a single disposer that tears everything it made back down.
export type BlockFn = (parent: Node, anchor: Node | null) => Disposer

// A self-contained, re-usable DOM builder — the value produced by `{#component}` calls and the
// component `{children()}` slot.
export interface Mountable {
    mount(target: Node, anchor: Node | null): () => void
}

// A client component: called with props, an optional children factory, and (for `.abide` file-component
// adapters) the caller's parent scope, returns (optionally) a Mountable that renders its output.
export type ClientComponent = (
    props: Record<string, unknown>,
    children: (() => Mountable) | null,
    parentScope?: unknown,
    // The invocation's STABLE site id (from the shared template plan). A `.abide` adapter opens its seed
    // bucket by this rather than by mount order — see `seededState.makeSeededState`.
    siteId?: number,
) => unknown

// ---------------------------------------------------------------------------
// Value coercion / guards
// ---------------------------------------------------------------------------

export function text(value: unknown): string {
    if (value === null || value === undefined) return ''
    return String(value)
}

export function isThenable(value: unknown): value is Promise<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Promise<unknown>).then === 'function'
    )
}

export function isMountable(value: unknown): value is Mountable {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Mountable).mount === 'function'
    )
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function insert(target: Node, node: Node, anchor: Node | null): void {
    if (anchor !== null) target.insertBefore(node, anchor)
    else target.appendChild(node)
}

export function remove(node: Node): void {
    const parent = node.parentNode
    if (parent !== null) parent.removeChild(node)
}

// Cursor helpers (dual-mode-ready). PR1 only uses the clone path via `template` + `finalize`.

export function template(html: string): HTMLTemplateElement {
    const node = document.createElement('template')
    node.innerHTML = html
    return node
}

// Null-tolerant by design: a desynced clone/hydrate walk can chain these past the end of a subtree.
// Returning null (rather than throwing on a null receiver) lets the walk finish with null node vars —
// the enclosing block/root recovers (hydrate) or the last-resort fresh mount proceeds — instead of a
// hard `TypeError` that would escape recovery and leave a dead page.
export function firstChild(node: Node | null): Node | null {
    return node === null ? null : node.firstChild
}

export function nextSibling(node: Node | null): Node | null {
    return node === null ? null : node.nextSibling
}

// Move every child of `fragment` into `parent` before `anchor`, preserving order.
export function finalize(fragment: Node, parent: Node, anchor: Node | null): void {
    let child = fragment.firstChild
    while (child !== null) {
        const next = child.nextSibling
        insert(parent, child, anchor)
        child = next
    }
}

// ---------------------------------------------------------------------------
// Hydration mode (Stage 2, PR3)
// ---------------------------------------------------------------------------

// Module-level flag: when true, leaf/element/attr helpers CLAIM existing server DOM instead of
// creating, and suppress their FIRST reactive write (decision 9 — trust server output; the replayed
// seed means the cell already holds the value the server rendered). Emitted client code reads it live
// as `$rt.hydrating` when acquiring a mount fragment; the helpers below read it at construction time,
// so the SAME emitted call reverts to creating DOM on later reactive re-runs (after `endHydration`).
export let hydrating = false

// Live read of the hydrate flag — true only while the cursor is CLAIMING server nodes (false in create
// mode / after `endHydration`). `seededState` consults this so a create-fallback re-mount doesn't replay
// (and desync) the seed ordinals. A function so importers see the current value, not a stale snapshot.
export function isHydrating(): boolean {
    return hydrating
}

// Seed the stateful cursor (PR4) at the container's first server child so the root mount fn's walk
// starts on real server DOM. Nested block-body mount fns are reseeded by their block helper.
export function startHydration(container?: Node | null): void {
    hydrating = true
    hydrateCursor = container !== undefined && container !== null ? container.firstChild : null
}

export function endHydration(): void {
    hydrating = false
    hydrateCursor = null
    hydrateForItem = false
}

// Stream attach handoff (replayable-streams.md §5): the seed's `streams` section warms the client RPC
// memo in `bootstrap.replayStreams` BEFORE hydrate (a completed mode-A transcript via `memo.seedStream`,
// or a mode-B prefix+resume source). The `{#for await}` hydrate path then just re-reads the warm memo —
// no separate DOM handoff, so there is no runtime-side handoff registry any more.

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const COMMENT_NODE = 8

// ---------------------------------------------------------------------------
// Stateful hydration cursor (Stage 2, PR4)
// ---------------------------------------------------------------------------
//
// PR3's positional `nav` (firstChild/nextSibling by child-index) desyncs the moment server DOM has a
// different child COUNT than the clone skeleton — which happens for (a) adjacent no-static-prefix
// leaves (`{a}{b}` — the server injects a value text node the clone lacks, shifting every later
// index) and (b) block bodies (`<!--[-->…content…<!--]-->` vs the clone's empty `<!--[--><!--]-->`).
// The fix (Svelte 5's `hydrate_node` pattern, adapted to abide's procedural idioms): a module-level
// cursor that walks the ACTUAL server DOM sibling-by-sibling. Each claim consumes from it and
// advances; block/element descent save+reseek it. Emitted client code, under `hydrating`, drives the
// cursor via these helpers INSTEAD of positional nav; the clone (mount) path never touches it.
//
// Comment-anchor conventions (emitted identically by `templatePlan`/`emitServer`):
//   • `<!---->`    (empty data)  — a leaf slot anchor (scalar interp / await / html).
//   • `<!--[-->`   (data "[")    — a block/component OPEN anchor. A component subtree ALWAYS arrives through
//                                  a component slot (`<Name/>`, `<slot/>`, `{children()}`), never an
//                                  interpolation — so a leaf position is always a scalar.
//   • `<!--]-->`   (data "]")    — the matching CLOSE anchor.
const BLOCK_OPEN = '['
const BLOCK_CLOSE = ']'

let hydrateCursor: Node | null = null
// Set by `forBlock` right before it claims a keyed item so that item's body mount fn bounds its
// `$roots` by the CURSOR (exact item extent) rather than by an anchor it cannot know up front.
let hydrateForItem = false

// The cursor's current node (what the next claim consumes). Emitted code reads this at each slot.
export function hydrateNode(): Node | null {
    return hydrateCursor
}

// Reposition the cursor (block/element descent, block-body entry).
export function hydrateSeek(node: Node | null): void {
    hydrateCursor = node
}

// Advance the cursor past `count` static server nodes (the gaps between dynamic slots at a level).
export function hydrateSkip(count: number): void {
    for (let i = 0; i < count && hydrateCursor !== null; i++)
        hydrateCursor = hydrateCursor.nextSibling
}

// Consume an interpolation/await value leaf: the cursor points at the value Text node (prefixLen===0,
// non-empty), or at the `<!---->` anchor (empty value, OR prefixLen>0 where the value merged into the
// preceding — already skipped — static text). Return that node (what `interpolate`/`awaitText` receive
// as their `end`, matching PR3's positional-nav contract), then advance past the anchor.
export function hydrateValueLeaf(): Node | null {
    const node = hydrateCursor
    if (node === null) return null
    if (node.nodeType === TEXT_NODE) {
        // value text node followed by its `<!---->` anchor → step past both
        hydrateCursor = node.nextSibling !== null ? node.nextSibling.nextSibling : null
    } else {
        // the `<!---->` anchor itself (empty value or merged prefix) → step past it
        hydrateCursor = node.nextSibling
    }
    return node
}

// Find the CLOSE anchor of an `{html(...)}` region. The OPEN anchor carries the exact token the server
// committed to (`[h`, `[h0`, … — escalated when the markup itself contained the close marker, see
// `serverRuntime.renderHtml`), so this scans for ONE unambiguous value. No depth counting is needed or
// wanted: the token is unique to this region by construction, which is what makes the extent sound even
// when the injected markup is abide's own SSR output.
export function findHtmlClose(open: Node | null): Node | null {
    if (open === null || open.nodeType !== COMMENT_NODE) return null
    const value = open.nodeValue
    if (value === null || !value.startsWith(HTML_ANCHOR.open)) return null
    const closeValue = HTML_ANCHOR.close + value.slice(HTML_ANCHOR.open.length)
    let node = open.nextSibling
    while (node !== null) {
        if (node.nodeType === COMMENT_NODE && node.nodeValue === closeValue) return node
        node = node.nextSibling
    }
    return null
}

// Find the CLOSE `<!--]-->` matching the OPEN `<!--[-->` at `open`, honoring nested block depth.
// Returns null when unmatched (→ callers fall back to create-from-scratch, decision 5).
export function findBlockClose(open: Node | null): Node | null {
    if (open === null) return null
    let node = open.nextSibling
    let depth = 0
    while (node !== null) {
        if (node.nodeType === COMMENT_NODE) {
            const value = node.nodeValue
            if (value === BLOCK_OPEN) depth++
            else if (value === BLOCK_CLOSE) {
                if (depth === 0) return node
                depth--
            }
        }
        node = node.nextSibling
    }
    return null
}

// Collect (WITHOUT detaching) the server nodes a mount fn owns at its level — `[start .. end)` — for
// its teardown `$roots`. `end` is the mount fn's `$anchor` (root: null → to the end; block body: the
// block marker) or, for a keyed for-item, the post-walk cursor (exact item extent).
export function claimRoots(start: Node | null, end: Node | null): Node[] {
    const roots: Node[] = []
    let node = start
    while (node !== null && node !== end) {
        roots.push(node)
        node = node.nextSibling
    }
    return roots
}

// Run `fn` with hydration temporarily OFF so it CREATES DOM even during a hydrate pass. Used for the
// switch `leading` region (client-only whitespace the server never renders → nothing to claim).
export function inCreateMode<T>(fn: () => T): T {
    const previous = hydrating
    hydrating = false
    try {
        return fn()
    } finally {
        hydrating = previous
    }
}

// Arm/consume the "next mount fn is a keyed for-item" flag (see `hydrateForItem`).
export function beginForItem(): void {
    hydrateForItem = true
}
export function consumeForItem(): boolean {
    const value = hydrateForItem
    hydrateForItem = false
    return value
}

// Remove server nodes `[start .. end)` — the graceful create-fallback for a block whose server region
// can't be claimed (async blocks under PR4; a mismatched anchor/branch).
function clearBetween(start: Node | null, end: Node | null): void {
    let node = start
    while (node !== null && node !== end) {
        const next = node.nextSibling
        remove(node)
        node = next
    }
}

// Claim the dynamic Text node for a leaf slot from server DOM. `navNode` is what the cursor walk
// landed on for the slot's anchor position (see the text-merge analysis in the Stage 2 plan §1):
//   • prefixLen > 0   → `navNode` is the anchor comment; the HTML parser merged the dynamic value
//     INTO the immediately-preceding static Text node, so split that node at `prefixLen` and return
//     the tail (`splitText` preserves the tail's node identity — no recreate).
//   • prefixLen === 0 → no static prefix reserved a positional slot, so `navNode` is the dynamic
//     value Text node directly — return it; OR it is the anchor comment when the value was empty
//     (server emitted no text node) → return null (caller creates lazily on first write).
export function claimText(navNode: Node | null, prefixLen: number): Text | null {
    if (navNode === null) return null
    if (prefixLen > 0) {
        const previous = navNode.previousSibling
        if (
            previous !== null &&
            previous.nodeType === TEXT_NODE &&
            (previous as Text).length > prefixLen
        ) {
            return (previous as Text).splitText(prefixLen)
        }
        return null
    }
    if (navNode.nodeType === TEXT_NODE) return navNode as Text
    return null
}

// ---------------------------------------------------------------------------
// Localized mismatch recovery (Stage 2, PR6) — decision 5
// ---------------------------------------------------------------------------
//
// After Stage 1 the server and client come from ONE emitter, so a hydration mismatch can only arise
// from non-deterministic render, external DOM mutation before hydrate, or the browser's HTML
// normalization on parse. The claim walk verifies CHEAPLY as it goes — the tag name at a dynamic
// element (`claimElement`) and the paired-anchor presence at a block boundary (`open`/`findBlockClose`)
// — but NEVER attribute equality (attributes are re-applied on claim, so verifying them is wasted).
// A failed check throws `HydrationMismatch`; the nearest enclosing block helper (or, at the root, the
// emitted `hydrate`) catches it, discards that region's server nodes, and re-runs the region in create
// mode. Regions OUTSIDE the failed one keep their claimed nodes — recovery is localized, not whole-page
// (whole-page is the last resort in `hydrate` when a mismatch escapes every block).

export class HydrationMismatch extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'HydrationMismatch'
    }
}

function describeNode(node: Node | null): string {
    if (node === null) return 'nothing (ran off the end of the server DOM)'
    if (node.nodeType === ELEMENT_NODE) return `<${(node as Element).tagName.toLowerCase()}>`
    if (node.nodeType === TEXT_NODE) return 'a text node'
    if (node.nodeType === COMMENT_NODE) return `a comment <!--${node.nodeValue}-->`
    return `node type ${node.nodeType}`
}

// Cheap ALWAYS-ON tag verification at a dynamic-element slot (decision 5): the claimed node must be an
// Element whose tag matches the template's (case-insensitive). Emitted inside the `hydrating` walk, so
// it costs nothing on the clone (mount) path. Returns the node (so the emitter can assign it inline)
// or throws — the enclosing block/root then recreates the affected subtree.
export function claimElement(node: Node | null, tag: string): Node | null {
    if (
        node === null ||
        node.nodeType !== ELEMENT_NODE ||
        (node as Element).tagName.toLowerCase() !== tag.toLowerCase()
    ) {
        throw new HydrationMismatch(`expected <${tag}> but found ${describeNode(node)}`)
    }
    return node
}

// Mismatch warning on the isomorphic `log` — the `abide:hydrate` channel, quiet unless
// `localStorage.debug` names it (so a prod user can surface it to debug without a rebuild). The
// RECOVERY itself runs unconditionally in the caller; only this diagnostic line is channel-gated.
export function warnHydrationMismatch(where: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    log.channel('abide:hydrate').warn(
        `hydration mismatch in ${where}: ${message} — recovering by re-rendering that subtree from scratch.`,
    )
}

// Run a block's claim `body` under hydration; on a nested `HydrationMismatch`, remove the block's
// server region `[open.next .. marker)` and re-run `body` in create mode (localized recovery). When not
// hydrating this is a pass-through (the create path is unchanged). `body` is safe to run twice: the
// failed claim pass throws out of the mount fn's cursor walk BEFORE it creates DOM or registers
// disposers, so no half-built state leaks.
function claimBlock(
    open: Node | null,
    marker: Node,
    where: string,
    body: () => Disposer,
): Disposer {
    if (!hydrating) return body()
    try {
        return body()
    } catch (error) {
        if (!(error instanceof HydrationMismatch)) throw error
        warnHydrationMismatch(where, error)
        clearBetween(open !== null ? open.nextSibling : null, marker)
        return inCreateMode(body)
    }
}

// A block whose OWN open anchor is absent (or is some other node — e.g. the `<!--[-->` was stripped and
// the cursor landed on real content) cannot locate or bound its server region. Bubble to the ENCLOSING
// block (or the root) which CAN clear+recreate from an anchor it owns, avoiding a mis-bounded partial
// clear that would DUPLICATE the region. Verifying the anchor is the cheap block-boundary check
// (decision 5), the counterpart to `claimElement`'s tag check. No-op off hydration.
function requireOpen(open: Node | null, where: string): void {
    if (!hydrating) return
    if (open === null || open.nodeType !== COMMENT_NODE || open.nodeValue !== BLOCK_OPEN) {
        throw new HydrationMismatch(`${where} open anchor missing`)
    }
}

// ---------------------------------------------------------------------------
// Reactive slots
// ---------------------------------------------------------------------------

// `{expr}` — reactive TEXT before `end`. Renders text and thenables (resolve → text). A component is not
// renderable here: it is invoked as a tag (`<Name/>`), which is a component slot with its own paired
// anchors, so this leaf is always a single scalar position on both the server and the hydrate walk.
export function interpolate(
    parent: Node,
    end: Node,
    read: () => unknown,
    prefixLen: number = 0,
): Disposer {
    let textNode: Text | null = null
    let thenGeneration = 0
    let primed = false

    if (hydrating) {
        // Claim the server-rendered text node (may be null for an empty value → created lazily below).
        textNode = claimText(end, prefixLen)
        primed = true
    }

    // Mirror of `serverRuntime.renderLeaf`'s guard, for a client-only mount (no SSR pass to throw first).
    // Statically visible component calls are rejected by `templatePlan` at compile time; this catches the
    // invisible one — a component arriving through props and called instead of tagged.
    const rejectComponent = (value: unknown): void => {
        if (isMountable(value))
            throw new Error(
                'a component reached an interpolation — invoke a component as a tag (`<Name …/>`), not a call (`{name(…)}`)',
            )
    }

    // Correct the CLAIMED server text to `shown` on the hydrate pass: write only on divergence, and
    // create the node when the server printed an empty value (nothing was claimed). Synchronous callers
    // only — a deferred fill must not create, or a late resolution would resurrect a disposed node.
    const showPrimed = (shown: string): void => {
        if (textNode !== null) {
            if (textNode.data !== shown) textNode.data = shown
        } else if (shown !== '') {
            textNode = document.createTextNode(shown)
            insert(parent, textNode, end)
        }
    }

    const dispose = effect(() => {
        const value = read()
        if (primed) {
            // First pass under hydration: `read()` above subscribed us, so trust the server's output — no
            // DOM write (decision 9). EXCEPTION: a client-only value (e.g. a `bind:element` node ref set
            // during mount, before this effect first ran) can already diverge from what the server printed
            // — detect that mismatch against the claimed node and correct it in place.
            primed = false
            rejectComponent(value)
            if (isThenable(value)) {
                // A settled hint means we know the value synchronously, so a thenable is no longer opaque
                // here: treat it exactly like a scalar and correct a diverged claim. With NO hint the read
                // is genuinely pending on the client (the server painted, but this slot was not seeded) —
                // keep the server text and register the fill so resolution CONVERGES the DOM rather than
                // waiting on a signal re-run that a settle-on-arrival read may never emit.
                const settled = peekSettled(value)
                if (settled !== undefined) return showPrimed(text(settled.value))
                const generation = ++thenGeneration
                value.then((resolved) => {
                    // Existing node only (see `showPrimed`). A server-empty claim has nothing to correct
                    // until the bare-read SSR semantics change, which is when this needs revisiting.
                    if (generation === thenGeneration && textNode !== null)
                        textNode.data = text(resolved)
                })
                return
            }
            showPrimed(text(value))
            return
        }
        rejectComponent(value)
        if (textNode === null) {
            textNode = document.createTextNode('')
            insert(parent, textNode, end)
        }
        if (isThenable(value)) {
            // A warm / seed-primed coalesced load resolves synchronously and tags its promise with the
            // value hint (`shared/internal/settledRead.ts`), so write it NOW rather than blanking and
            // refilling on the microtask. NOT a paint fix — that refill is never visible, since
            // microtasks drain before the rendering steps. What it buys is a DOM that is correct
            // SYNCHRONOUSLY after mount, for anything that reads without awaiting (measurement,
            // soft-nav scroll/focus restoration, tests), plus one less write and continuation.
            // No hint → genuinely pending (a real network wait), clear and fill.
            const settled = peekSettled(value)
            if (settled !== undefined) {
                thenGeneration++ // invalidate any in-flight promise
                textNode.data = text(settled.value)
                return
            }
            const generation = ++thenGeneration
            textNode.data = ''
            value.then((resolved) => {
                if (generation === thenGeneration && textNode !== null)
                    textNode.data = text(resolved)
            })
            return
        }
        thenGeneration++ // invalidate any in-flight promise
        textNode.data = text(value)
        return
    })

    return () => {
        dispose()
        if (textNode !== null) remove(textNode)
    }
}

// `{await expr}` — a single text node before `anchor` set from the resolved promise value.
export function awaitText(
    parent: Node,
    anchor: Node | null,
    read: () => unknown,
    prefixLen: number = 0,
): Disposer {
    let node: Text | null = null
    let primed = false
    if (hydrating) {
        node = claimText(anchor, prefixLen)
        primed = true
    }
    if (node === null) {
        node = document.createTextNode('')
        insert(parent, node, anchor)
    }
    const claimed = node
    let generation = 0
    const dispose = effect(() => {
        const value = read()
        if (primed) {
            // Trust the server-resolved value already in `claimed` (decision 9); wire future updates only.
            // EXCEPTION, mirroring `interpolate`: a settled hint gives us the value synchronously, so a
            // divergence from what the server printed is correctable in place instead of silently kept.
            primed = false
            const settledPrimed = peekSettled(value)
            if (settledPrimed !== undefined) {
                const shown = text(settledPrimed.value)
                if (claimed.data !== shown) claimed.data = shown
            }
            return
        }
        // Warm / seed-primed reads carry the value hint — write without the clear-then-microtask-refill,
        // so the DOM is correct synchronously after mount (see `interpolate`; not a paint fix).
        const settled = peekSettled(value)
        if (settled !== undefined) {
            generation++ // invalidate any in-flight fill
            claimed.data = text(settled.value)
            return
        }
        const current = ++generation
        claimed.data = ''
        Promise.resolve(value).then((resolved) => {
            if (current === generation) claimed.data = text(resolved)
        })
    })
    return () => {
        dispose()
        remove(claimed)
    }
}

// `{html(expr)}` — raw markup between the region's `open`/`close` anchors, re-rendered on change.
export function htmlBlock(
    parent: Node,
    open: Node | null,
    close: Node | null,
    read: () => unknown,
): Disposer {
    let primed = hydrating
    return effect(() => {
        const value = read()
        if (primed) {
            // Claim the server-rendered raw nodes by READING the extent off the anchors the server wrote
            // (`serverRuntime.renderHtml`) — their identities are the server's, no recreate. Deliberately
            // NOT re-derived from the markup: a probe re-parse mis-counts in a context-sensitive parent
            // (a `<td>` is dropped inside a bare `<div>`) and whenever the markup's leading text merged
            // with the preceding sibling, both of which claimed the wrong nodes.
            primed = false
            if (open === null || close === null)
                throw new HydrationMismatch('{html(...)} anchors not found for claim')
            const claimed = claimRoots(nextSibling(open), close)
            return () => {
                for (const child of claimed) remove(child)
            }
        }
        const markup = value === null || value === undefined ? '' : String(value)
        const container = document.createElement('div')
        container.innerHTML = markup
        const nodes = Array.from(container.childNodes)
        for (const child of nodes) insert(parent, child, close)
        return () => {
            for (const child of nodes) remove(child)
        }
    })
}

// ---------------------------------------------------------------------------
// Attributes / events
// ---------------------------------------------------------------------------

const FORM_PROPERTY_NAMES = new Set(['value', 'checked', 'selected', 'disabled'])

export function applyAttribute(element: Element, name: string, value: unknown): void {
    if (value === false || value === null || value === undefined) {
        element.removeAttribute(name)
        if (FORM_PROPERTY_NAMES.has(name))
            (element as unknown as Record<string, unknown>)[name] = false
        return
    }
    if (value === true) {
        element.setAttribute(name, '')
        if (FORM_PROPERTY_NAMES.has(name))
            (element as unknown as Record<string, unknown>)[name] = true
        return
    }
    if (name === 'value' && 'value' in element) {
        ;(element as unknown as Record<string, unknown>).value = value
        return
    }
    element.setAttribute(name, String(value))
}

// A reactive effect that suppresses its FIRST apply under hydration — the server already serialized
// this attribute/class/style (decision 9); values are re-applied not verified (decision 5). `read`
// runs on every pass (so its deps are tracked from the first run), but `apply` is skipped once while
// priming. Used by every whole-value binding (`setAttr`/`toggleClass`/`setStyleProp`).
function hydratableEffect(read: () => unknown, apply: (value: unknown) => void): Disposer {
    let primed = hydrating
    return effect(() => {
        const value = read()
        if (primed) {
            primed = false
            return
        }
        apply(value)
    })
}

export function setAttr(element: Element, name: string, read: () => unknown): Disposer {
    return hydratableEffect(read, (value) => applyAttribute(element, name, value))
}

export function toggleClass(element: Element, className: string, read: () => unknown): Disposer {
    return hydratableEffect(read, (value) => element.classList.toggle(className, Boolean(value)))
}

export function setStyleProp(element: Element, property: string, read: () => unknown): Disposer {
    return hydratableEffect(read, (value) => {
        const style = (element as HTMLElement).style
        if (value === false || value === null || value === undefined) style.removeProperty(property)
        else style.setProperty(property, String(value))
    })
}

export function listen(element: Element, eventName: string, read: () => unknown): Disposer {
    const handler = (event: Event): void => {
        const fn = read()
        if (typeof fn === 'function') (fn as (event: Event) => void)(event)
    }
    element.addEventListener(eventName, handler)
    return () => element.removeEventListener(eventName, handler)
}

export function spread(element: Element, read: () => unknown): Disposer {
    let previousKeys: string[] = []
    let previousHandlerKeys: string[] = []
    let primed = hydrating
    return effect(() => {
        const value = read()
        const nextKeys: string[] = []
        const nextHandlerKeys: string[] = []
        if (value !== null && typeof value === 'object') {
            for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
                if (typeof entry === 'function' && /^on[a-z]/.test(key)) {
                    // Event props attach unconditionally — free during the walk (decision 7).
                    ;(element as unknown as Record<string, unknown>)[key] = entry
                    nextHandlerKeys.push(key)
                    continue
                }
                // Under hydration, skip re-applying attributes on the first pass (decision 9) but still
                // record `nextKeys` so subsequent runs can remove ones the value later drops.
                if (!primed) applyAttribute(element, key, entry)
                nextKeys.push(key)
            }
        }
        if (!primed) {
            for (const key of previousKeys) {
                if (!nextKeys.includes(key)) element.removeAttribute(key)
            }
        }
        // Event handlers are set as properties (not attributes), so a dropped one must be nulled out
        // explicitly — removeAttribute won't clear it. Runs every pass (handlers attach every pass).
        for (const key of previousHandlerKeys) {
            if (!nextHandlerKeys.includes(key))
                (element as unknown as Record<string, unknown>)[key] = null
        }
        previousKeys = nextKeys
        previousHandlerKeys = nextHandlerKeys
        primed = false
    })
}

// ---------------------------------------------------------------------------
// Two-way binding (C7) and bind:element (C5)
// ---------------------------------------------------------------------------

export interface Accessor {
    read: () => unknown
    write: (value: unknown) => void
}

// Resolve a bound value to a read/write accessor. Accepts a writable state (callable with `.set`)
// or an explicit `{ get, set }` object.
export function boundAccessor(bound: unknown): Accessor | null {
    if (typeof bound === 'function' && typeof (bound as { set?: unknown }).set === 'function') {
        const stateLike = bound as (() => unknown) & { set: (value: unknown) => void }
        return { read: () => stateLike(), write: (value) => stateLike.set(value) }
    }
    if (bound !== null && typeof bound === 'object') {
        const object = bound as { get?: () => unknown; set?: (value: unknown) => void }
        const get = object.get
        const set = object.set
        if (typeof get === 'function' && typeof set === 'function') {
            return { read: () => get(), write: (value) => set(value) }
        }
    }
    return null
}

export function bindChecked(element: Element, accessor: Accessor): Disposer {
    const input = element as HTMLInputElement
    const dispose = hydratableEffect(
        () => Boolean(accessor.read()),
        (value) => {
            input.checked = value as boolean
        },
    )
    const handler = (): void => accessor.write(input.checked)
    input.addEventListener('change', handler)
    return () => {
        dispose()
        input.removeEventListener('change', handler)
    }
}

export function bindValue(element: Element, accessor: Accessor): Disposer {
    const input = element as HTMLInputElement
    const dispose = hydratableEffect(
        () => accessor.read(),
        (value) => {
            input.value = value === null || value === undefined ? '' : String(value)
        },
    )
    const isNumber = input.type === 'number' || input.type === 'range'
    const eventName = element.tagName === 'SELECT' ? 'change' : 'input'
    const handler = (): void => accessor.write(isNumber ? Number(input.value) : input.value)
    input.addEventListener(eventName, handler)
    return () => {
        dispose()
        input.removeEventListener(eventName, handler)
    }
}

export function bindGroup(input: HTMLInputElement, accessor: Accessor): Disposer {
    const isCheckbox = input.type === 'checkbox'
    const dispose = hydratableEffect(
        () => accessor.read(),
        (current) => {
            if (isCheckbox) input.checked = Array.isArray(current) && current.includes(input.value)
            else input.checked = current === input.value
        },
    )
    const handler = (): void => {
        if (isCheckbox) {
            const current = accessor.read()
            const list = Array.isArray(current) ? current.slice() : []
            const at = list.indexOf(input.value)
            if (input.checked && at === -1) list.push(input.value)
            else if (!input.checked && at !== -1) list.splice(at, 1)
            accessor.write(list)
        } else if (input.checked) {
            accessor.write(input.value)
        }
    }
    input.addEventListener('change', handler)
    return () => {
        dispose()
        input.removeEventListener('change', handler)
    }
}

// `bind:element` — assign the node to a writable state cell (cleared on teardown) or invoke an
// attachment function (its return value is a teardown). Returns undefined when `bound` is neither.
export function bindElement(element: Element, bound: unknown): Disposer | undefined {
    // Attach fn: a plain function WITHOUT a state `.set` — call it, its return value is the teardown.
    if (typeof bound === 'function' && typeof (bound as { set?: unknown }).set !== 'function') {
        const teardown = (bound as (node: Element) => unknown)(element)
        return typeof teardown === 'function' ? (teardown as Disposer) : undefined
    }
    // Node-ref cell: a writable state (callable + `.set`) or a `{ get, set }` accessor — the latter is
    // what a bare `state()` cell compiles to (TODO #22). Assign the node, clear it on teardown.
    const accessor = boundAccessor(bound)
    if (accessor !== null) {
        accessor.write(element)
        return () => {
            if (accessor.read() === element) accessor.write(undefined)
        }
    }
    return undefined
}

// ---------------------------------------------------------------------------
// Components (C4)
// ---------------------------------------------------------------------------

export function component(
    parent: Node,
    open: Node | null,
    anchor: Node | null,
    name: string,
    componentFn: unknown,
    props: Record<string, unknown>,
    childrenFn: (() => Mountable) | null,
    parentScope?: unknown,
    siteId?: number,
): Disposer {
    if (typeof componentFn !== 'function') {
        throw new Error(`<${name}> is not a component in scope (expected a mount function)`)
    }
    requireOpen(open, `component <${name}>`)
    const marker = document.createComment(name)
    insert(parent, marker, anchor)
    // Claim: point the cursor at the component's server region so a pass-through component's
    // `{children()}` mount fn claims the server-rendered children in place (rather than re-creating).
    if (hydrating) hydrateSeek(open !== null ? open.nextSibling : null)
    // `parentScope` (3rd arg) lets a `.abide` file-component's default adapter build its child scope
    // via `Object.create(parentScope)`; inline component factories use rest params and ignore it.
    const result = untrack(() =>
        (componentFn as ClientComponent)(props, childrenFn, parentScope, siteId),
    )
    // The children mount claims the server region; a mismatch inside it recovers locally (decision 5).
    const inner = isMountable(result)
        ? claimBlock(open, marker, `component <${name}>`, () => result.mount(parent, marker))
        : null
    return () => {
        if (inner !== null) inner()
        remove(marker)
    }
}

// A component whose identity is REACTIVE — the tag name is a cell or memo (e.g. `const C = memo(() =>
// done ? Done : Pending)`, invoked `<C/>`). Reads the componentFn in an effect and, when it changes,
// disposes the live instance and mounts the new one between the same slot anchors. The first run (under
// hydration) claims the server nodes exactly like a static `component()`; later runs mount fresh.
export function dynamicComponent(
    parent: Node,
    open: Node | null,
    anchor: Node | null,
    name: string,
    read: () => unknown,
    props: Record<string, unknown>,
    childrenFn: (() => Mountable) | null,
    parentScope?: unknown,
    siteId?: number,
): Disposer {
    let dispose: Disposer | null = null
    const stop = effect(() => {
        const fn = read()
        untrack(() => {
            if (dispose !== null) {
                dispose()
                dispose = null
            }
            dispose = component(
                parent,
                open,
                anchor,
                name,
                fn,
                props,
                childrenFn,
                parentScope,
                siteId,
            )
        })
    })
    return () => {
        stop()
        if (dispose !== null) dispose()
    }
}

// ---------------------------------------------------------------------------
// Control flow (C8)
// ---------------------------------------------------------------------------

export interface Branch {
    condition: (() => unknown) | null
    body: BlockFn
}

export function ifBlock(
    parent: Node,
    open: Node | null,
    anchor: Node | null,
    branches: Branch[],
): Disposer {
    requireOpen(open, '{#if}')
    const marker = document.createComment('if')
    insert(parent, marker, anchor)
    // Claim: seed-primed conditions select the SAME branch the server rendered (untracked, decision 9);
    // the selected body's mount fn then claims the server region `[open.next .. marker)`. On a later
    // reactive re-run `hydrating` is false, so a branch FLIP creates fresh DOM (expected).
    if (hydrating) hydrateSeek(open !== null ? open.nextSibling : null)
    const dispose = effect(() => {
        // Indexed loop, not `branches.entries()`: this runs inside a reactive effect, and the iterator
        // allocated a `[i, branch]` tuple per branch tested on every re-evaluation.
        let index = -1
        for (let i = 0; i < branches.length; i++) {
            const branch = branches[i]
            if (branch === undefined) continue
            if (branch.condition === null || branch.condition()) {
                index = i
                break
            }
        }
        if (index === -1) return
        const selected = branches[index]
        if (selected === undefined) throw new Error('{#if}: selected branch index out of range')
        return untrack(() => claimBlock(open, marker, '{#if}', () => selected.body(parent, marker)))
    })
    return () => {
        dispose()
        remove(marker)
    }
}

export interface Case {
    test: (() => unknown) | null
    body: BlockFn
}

export function switchBlock(
    parent: Node,
    open: Node | null,
    anchor: Node | null,
    read: () => unknown,
    leading: BlockFn,
    cases: Case[],
): Disposer {
    requireOpen(open, '{#switch}')
    const marker = document.createComment('switch')
    insert(parent, marker, anchor)
    const selectAndMount = (): Disposer | undefined => {
        const subject = read()
        let match = -1
        let fallback = -1
        for (let i = 0; i < cases.length; i++) {
            const entry = cases[i]
            if (entry === undefined) continue
            if (entry.test === null) {
                fallback = i
                continue
            }
            if (entry.test() === subject) {
                match = i
                break
            }
        }
        const index = match !== -1 ? match : fallback
        if (index === -1) return
        const selected = cases[index]
        if (selected === undefined) throw new Error('{#switch}: selected case index out of range')
        return untrack(() =>
            claimBlock(open, marker, '{#switch}', () => selected.body(parent, marker)),
        )
    }
    if (hydrating) {
        // The server omits `leading` (its switch render emits only the matched case), so the case body
        // claims the server region while `leading` (client-only whitespace) is CREATED, not claimed.
        hydrateSeek(open !== null ? open.nextSibling : null)
        const dispose = effect(selectAndMount)
        const leadingDispose = inCreateMode(() => leading(parent, marker))
        return () => {
            dispose()
            leadingDispose()
            remove(marker)
        }
    }
    // Leading (usually whitespace) is static, mounted once before the reactive case region.
    const leadingDispose = leading(parent, marker)
    const dispose = effect(selectAndMount)
    return () => {
        dispose()
        leadingDispose()
        remove(marker)
    }
}

export interface AwaitBranches {
    pending: BlockFn
    then: ((value: unknown) => BlockFn) | null
    catch: ((error: unknown) => BlockFn) | null
    finally: BlockFn | null
}

// Streaming SSR (PR3): if the first node after the block's `open` anchor is a streamed slot's opening
// `<!--ab-p:N-->` sentinel (its resolved-branch patch has landed and replaced the fallback between the
// sentinels — module-deferred hydration runs after every patch, so on first load it always has), drop
// BOTH sentinels so the patched branch sits directly between the block anchors. The sentinels are a
// comment + a `<template>` rather than a wrapper element because a wrapper inside a table section is
// foster-parented out of it by the parser. Leaves a non-streamed region untouched (no sentinel → no-op).
function unwrapStreamSlot(parent: Node, open: Node): void {
    const marker = open.nextSibling
    if (marker === null || marker.nodeType !== 8) return
    const id = (marker as Comment).data
    if (!id.startsWith('ab-p:')) return
    const sentinel = document.getElementById(id)
    parent.removeChild(marker)
    if (sentinel !== null) sentinel.remove()
}

export function awaitBlock(
    parent: Node,
    open: Node | null,
    anchor: Node | null,
    read: () => unknown,
    branches: AwaitBranches,
): Disposer {
    requireOpen(open, '{#await}')
    const marker = document.createComment('await')

    // Hydration (PR5). The server SSR-awaits the resolved expression and emits the RESOLVED branch's
    // HTML (`then` or, on rejection, `catch`) followed by `finally` — never `pending`. The create path
    // below mounts `pending` first and swaps on a microtask, so a naive hydrate would repaint. Instead:
    // PEEK whether the awaited expression is already SETTLED at hydrate time. It is settled iff calling
    // `read()` returns a NON-thenable (a seed-primed RPC/memo smart-read returns its value
    // synchronously; a plain non-promise resolves to itself) or throws synchronously (→ the `catch`
    // branch). A real, still-pending Promise is a thenable we cannot inspect synchronously — that is the
    // one unavoidable case, and it falls back to CREATE (clear the server region + mount `pending`).
    if (hydrating && open !== null) {
        // Streaming SSR (PR3): a slow read was streamed as a patch that filled an `<abide-slot>` wrapper
        // between the block anchors. Flatten it — move the resolved branch out to sit DIRECTLY between the
        // anchors and drop the wrapper — so the claim below is byte-for-byte the same as a non-streamed
        // block (decision (a) unwrap): after hydration a streamed block is indistinguishable from an inline
        // one, so every downstream reactive-swap / teardown path stays single-codepath.
        unwrapStreamSlot(parent, open)
        try {
            const claimed = claimAwait(parent, open, anchor, marker, read, branches)
            if (claimed !== null) return claimed
        } catch (error) {
            // A wrong-tag/anchor mismatch inside the claimed branch degrades to the same create-fallback.
            if (!(error instanceof HydrationMismatch)) throw error
            warnHydrationMismatch('{#await}', error)
        }
        // Create-fallback: discard the server-resolved region and re-mount from `pending`. Runs with
        // hydration OFF so the branch mount fns CREATE (the cursor is stale here) rather than mis-claim.
        clearBetween(open.nextSibling, anchor)
        if (marker.parentNode !== null) remove(marker)
        insert(parent, marker, anchor)
        return inCreateMode(() => runAwaitEffect(parent, marker, read, branches, null))
    }

    insert(parent, marker, anchor)
    return runAwaitEffect(parent, marker, read, branches, null)
}

// Attempt to claim the server-resolved await region in place. Returns a disposer on success (marker
// inserted, resolved branch + `finally` claimed, effect wired for FUTURE invalidation), or null when
// the expression is not synchronously settled / has no branch to claim (caller create-falls-back).
function claimAwait(
    parent: Node,
    open: Node,
    anchor: Node | null,
    marker: Comment,
    read: () => unknown,
    branches: AwaitBranches,
): Disposer | null {
    let value: unknown
    let error: unknown
    let isError = false
    try {
        const settledValue = untrack(() => read())
        if (isThenable(settledValue)) {
            // Promise-read model: a seed-primed coalesced load is already settled and tags its promise with
            // a synchronous value hint, so we can still claim the server branch. No hint → real pending.
            const settled = peekSettled(settledValue)
            if (settled === undefined) return null
            value = settled.value
        } else {
            value = settledValue
        }
    } catch (caught) {
        error = caught
        isError = true
    }
    const bodyFn = isError
        ? branches.catch !== null
            ? branches.catch(error)
            : null
        : branches.then !== null
          ? branches.then(value)
          : null
    if (bodyFn === null) return null // server rendered `pending`/no branch — create-fallback

    // DOM: [open] [resolved-branch] [finally?] [close]. Insert the marker before close so claimed
    // content sits before it (matching the create path) and future swaps mount before it. Claim in
    // document order off the cursor; `beginForItem` bounds each sub-mount's roots by the cursor (its
    // exact node extent) rather than the shared marker, so `then` does not over-claim `finally`.
    insert(parent, marker, anchor)
    // Snapshot EVERY claimed server node in the region `[open.nextSibling .. marker)`. A branch mount
    // fn only claims (as its `$roots`) the nodes its cursor walk advanced over — so a FULLY-STATIC
    // branch (e.g. a `{:finally}` with no dynamic slots) claims nothing, and inter-branch whitespace
    // that the parser merged into a shared text node falls outside any branch's roots. On a later
    // reactive swap those unclaimed nodes would leak (duplicate `{:finally}`, stale `{:then}`). This
    // region snapshot is removed on teardown so the whole server region is torn down before the pending
    // rebuild. `remove` is idempotent, so double-removing nodes a branch already claimed is safe.
    const claimedRegion: Node[] = []
    for (let node = open.nextSibling; node !== null && node !== marker; node = node.nextSibling)
        claimedRegion.push(node)
    hydrateSeek(open.nextSibling)
    const claimedDisposers: Disposer[] = []
    beginForItem()
    claimedDisposers.push(untrack(() => bodyFn(parent, marker)))
    if (branches.finally !== null) {
        const finallyFn = branches.finally
        beginForItem()
        claimedDisposers.push(untrack(() => finallyFn(parent, marker)))
    }
    claimedDisposers.push(() => {
        for (const node of claimedRegion) remove(node)
    })
    return runAwaitEffect(parent, marker, read, branches, claimedDisposers)
}

// The reactive await machinery, shared by the create path and the hydration-claim path. When
// `claimedFirst` is non-null the effect's FIRST run ADOPTS the already-claimed DOM and suppresses the
// pending→settle swap (decision 9 — trust server output). Any later re-run (invalidate/refresh
// changes `read()`'s deps) disposes the claimed DOM via the returned cleanup and rebuilds through the
// normal pending→swap path.
function runAwaitEffect(
    parent: Node,
    marker: Comment,
    read: () => unknown,
    branches: AwaitBranches,
    claimedFirst: Disposer[] | null,
): Disposer {
    const dispose = effect(() => {
        // A synchronously-throwing expression routes to `catch` (mirrors the server's try/await/catch).
        let promise: unknown
        let syncError: unknown
        let threw = false
        try {
            promise = read()
        } catch (caught) {
            syncError = caught
            threw = true
        }
        if (claimedFirst !== null) {
            const adopted = claimedFirst
            claimedFirst = null
            return () => {
                for (const d of adopted) d()
            }
        }
        let branchDisposers: Disposer[] = []
        let settled = false
        branchDisposers.push(untrack(() => branches.pending(parent, marker)))

        const swap = (bodyFn: BlockFn | null): void => {
            if (settled) return
            settled = true
            for (const d of branchDisposers) d()
            branchDisposers = []
            // Source order — the resolved branch (`then`/`catch`) renders BEFORE `finally`, matching the
            // template and the hydration-claim path. Both mount before `marker`, so `bodyFn` first puts its
            // nodes ahead of `finally`'s.
            if (bodyFn !== null) branchDisposers.push(untrack(() => bodyFn(parent, marker)))
            if (branches.finally !== null) {
                const finallyFn = branches.finally
                branchDisposers.push(untrack(() => finallyFn(parent, marker)))
            }
        }

        if (threw) {
            if (branches.catch !== null) swap(branches.catch(syncError))
        } else {
            Promise.resolve(promise).then(
                (value) => swap(branches.then !== null ? branches.then(value) : null),
                (error) => {
                    if (branches.catch !== null) swap(branches.catch(error))
                },
            )
        }

        return () => {
            settled = true
            for (const d of branchDisposers) d()
        }
    })

    return () => {
        dispose()
        remove(marker)
    }
}

export function tryBlock(
    parent: Node,
    open: Node | null,
    anchor: Node | null,
    body: BlockFn,
    catchFn: ((error: unknown) => BlockFn) | null,
    finallyFn: BlockFn | null,
): Disposer {
    requireOpen(open, '{#try}')
    const marker = document.createComment('try')
    insert(parent, marker, anchor)
    // Claim: body (then finally) mount fns claim the server region in document order off the cursor.
    if (hydrating) hydrateSeek(open !== null ? open.nextSibling : null)
    const disposers: Disposer[] = []
    // The node preceding `marker` before the body mounts — the boundary for cleanup on a throw. The body
    // inserts its nodes contiguously right before `marker`, but if it throws MID-MOUNT (a `{#if}`/interp
    // expression inside the body throws) it never returns its disposer, so those already-inserted nodes
    // are untracked. Removing everything from here to `marker` clears that partial DOM before `:catch`
    // mounts — otherwise the half-rendered body leaks alongside the catch branch (decision: JS-semantics
    // error boundary — the body's side effects are rolled back).
    const boundary = marker.previousSibling
    try {
        // A HYDRATION mismatch (wrong tag/anchor) in the body is NOT a user error — `claimBlock` recovers
        // it in place (clear + recreate) and returns normally; only genuine user throws reach the `:catch`.
        disposers.push(claimBlock(open, marker, '{#try}', () => body(parent, marker)))
    } catch (error) {
        for (const d of disposers) d()
        disposers.length = 0
        while (marker.previousSibling !== null && marker.previousSibling !== boundary)
            remove(marker.previousSibling)
        if (catchFn !== null) {
            disposers.push(catchFn(error)(parent, marker))
        } else {
            throw error
        }
    }
    if (finallyFn !== null) disposers.push(finallyFn(parent, marker))
    return () => {
        for (const d of disposers) d()
        remove(marker)
    }
}

// ---------------------------------------------------------------------------
// Keyed list reconciliation (C8.2)
// ---------------------------------------------------------------------------

// Per-item lifecycle owned by the caller: `update` re-seeds item/index (and rebinds destructured
// patterns), `dispose` tears down the item body. The runtime owns the start/end markers.
export interface ForItemHandle {
    update(value: unknown, index: number): void
    dispose(): void
}

// Builds an item body between the given markers (already inserted into `parent`).
export type ForItemFactory = (
    parent: Node,
    startMarker: Comment,
    endMarker: Comment,
    value: unknown,
    index: number,
) => ForItemHandle

export interface ForOptions {
    read: () => unknown
    isAwait: boolean
    keyFor: (value: unknown, index: number) => unknown
    createItem: ForItemFactory
    catch: ((error: unknown) => BlockFn) | null
}

interface ListItem {
    key: unknown
    startMarker: Comment
    endMarker: Comment
    handle: ForItemHandle
    // Scratch flag owned by `reconcile`: set on the items carried into the next run, so the removal
    // pass can spot the dropped ones without building a Set of the survivors. Meaningless between runs.
    reused: boolean
}

// The `{#for}` source as an array. An ARRAY passes through uncopied — the list is consumed
// synchronously by the walk that receives it and never retained, so the defensive copy `Array.from`
// made was pure per-update allocation (a 200-row list re-runs this on every reactive change).
// Any other iterable is materialized as before.
function toItemArray(raw: unknown): unknown[] {
    if (raw === null || raw === undefined) return []
    if (Array.isArray(raw)) return raw as unknown[]
    return Array.from(raw as Iterable<unknown>)
}

// Move `[startMarker .. endMarker]` (inclusive) to sit before `reference`, preserving order. Each
// node's successor is read BEFORE the move, since `insertBefore` detaches it from the old position.
function moveRange(parent: Node, startMarker: Node, endMarker: Node, reference: Node): void {
    let node: Node | null = startMarker
    while (node !== null) {
        const next: Node | null = node === endMarker ? null : node.nextSibling
        parent.insertBefore(node, reference)
        node = next
    }
}

function createListItem(
    parent: Node,
    blockEnd: Node,
    value: unknown,
    index: number,
    key: unknown,
    factory: ForItemFactory,
): ListItem {
    const startMarker = document.createComment('for')
    const endMarker = document.createComment('/for')
    insert(parent, startMarker, blockEnd)
    insert(parent, endMarker, blockEnd)
    const handle = factory(parent, startMarker, endMarker, value, index)
    return { key, startMarker, endMarker, handle, reused: false }
}

function removeListItem(item: ListItem): void {
    item.handle.dispose()
    remove(item.startMarker)
    remove(item.endMarker)
}

// The trailing `<template id="ab-l:N">` a STREAMED `{#for await}` region ends with: items are emitted bare
// and the sentinel trails them as the append insertion point (`streamScope.forAwaitStream`). A
// non-streaming render paints the items with no sentinel at all, so its absence is normal, not a mismatch.
function streamSentinelBefore(end: Node | null): Node | null {
    const previous = end === null ? null : end.previousSibling
    if (previous === null || previous.nodeType !== ELEMENT_NODE) return null
    const element = previous as Element
    if (element.tagName !== 'TEMPLATE' || !element.id.startsWith('ab-l:')) return null
    return element
}

// CLAIM a server-painted `{#for await}` region in place rather than clearing it and re-painting. Returns
// how many items were claimed, or -1 when the region can't be claimed at all.
//
// The blocker used to be that binding item i needs its VALUE synchronously, and the source read is a
// Promise. A `seedStream`-warmed slot now tags its cursor with the transcript behind it
// (`shared/internal/streamTranscript.ts`), and the read carries a settled hint — so the values ARE
// available synchronously here. A cold source (no handoff recorded: a non-RPC iterable, a pre-deadline
// error) has neither, and correctly falls back to clear-and-create.
//
// Items carry no per-item boundary in the server HTML, so this uses the same trick as the sync `{#for}`
// claim: bracket each with the `<!--for-->`/`<!--/for-->` markers the create path uses and let the item
// body's own claim consume exactly its nodes (bounded by the `hydrateForItem` flag). It stops at the
// sentinel/blockEnd rather than at a count, so a region cut off mid-stream claims its prefix and leaves
// the rest to the drain.
function claimStreamedRegion(
    parent: Node,
    open: Node,
    blockEnd: Node,
    source: unknown,
    options: ForOptions,
    items: ListItem[],
): number {
    const settled = peekSettled(source)
    if (settled === undefined) return -1
    const chunks = streamTranscriptOf(settled.value)
    if (chunks === undefined) return -1
    const regionEnd = streamSentinelBefore(blockEnd) ?? blockEnd
    let claimed = 0
    try {
        hydrateSeek(open.nextSibling)
        while (claimed < chunks.length) {
            const at = hydrateNode()
            if (at === null || at === regionEnd) break
            const value = chunks[claimed]
            const key = options.keyFor(value, claimed)
            const startMarker = document.createComment('for')
            insert(parent, startMarker, hydrateNode())
            const endMarker = document.createComment('/for')
            beginForItem()
            const handle = options.createItem(parent, startMarker, endMarker, value, claimed)
            insert(parent, endMarker, hydrateNode())
            items.push({ key, startMarker, endMarker, handle, reused: false })
            claimed++
        }
    } catch (error) {
        if (!(error instanceof HydrationMismatch)) throw error
        warnHydrationMismatch('{#for await}', error)
        return -1
    }
    // Whatever the loop did not consume — the sentinel, plus any painted tail the transcript no longer
    // covers — belongs to no claimed item. Drop it so the drain appends onto a clean region.
    clearBetween(hydrateNode(), blockEnd)
    return claimed
}

export function forBlock(
    parent: Node,
    open: Node | null,
    anchor: Node | null,
    options: ForOptions,
): Disposer {
    const blockEnd = document.createComment('for-end')
    insert(parent, blockEnd, anchor)
    let items: ListItem[] = []

    // Async `{#for await}` hydrate (replayable-streams.md §5). `replayStreams` (bootstrap) has already
    // WARM-SEEDED the memo from the handoff (a completed mode-A transcript, or a mode-B prefix+resume
    // source), so the read replays with no client re-invoke. What it could NOT do until now is claim the
    // painted nodes — binding item i needs its value synchronously — so the region was cleared and
    // re-painted. It is now claimed in place when the transcript is reachable (see `claimStreamedRegion`).
    //
    // The claim happens on the effect's FIRST run, off the source that run already read: reading here
    // instead would INVOKE a cold non-memo source a second time (a memo coalesces; a bare `gen()` does not).
    const claimServerRegion = hydrating && options.isAwait && open !== null
    let firstRun = true

    if (options.isAwait) {
        // Reactive drain — a warm-seeded SSR-adopted stream (mode A or B), a fresh client mount, or a
        // non-RPC source on hydrate.
        // Wrap the drain in an effect so a source `.refresh()`/`.invalidate()` — or any tracked reactive
        // dep in the source expression — tears the list down and re-streams it (clear-and-restream);
        // previously a `{#for await}` was a ONE-SHOT mount that ignored every post-mount change (issue
        // #52). For an SSR-adopted stream the memo was warm-seeded (`replayStreams`), so this first drain
        // replays the transcript with NO client re-invoke; a fresh/non-RPC source loads as before.
        let generation = 0
        let catchDispose: Disposer | null = null
        const clearRun = (): void => {
            for (const item of items) removeListItem(item)
            items = []
            if (catchDispose !== null) {
                catchDispose()
                catchDispose = null
            }
        }
        const stop = effect(() => {
            // Reading the source subscribes this effect to the backing memo's STATE state (invalidate/
            // refresh) plus any reactive dep in the args — but NOT to per-chunk growth (the memo keeps
            // that on a separate `streamTick`), so live chunks arriving never restart the block.
            const source = options.read()
            const runGen = ++generation
            const stale = (): boolean => generation !== runGen
            // Only the FIRST run claims: its items are mounted over the server's own nodes. Every later run
            // (a refresh/invalidate) is a genuine clear-and-restream, and every run after a failed claim
            // starts from an already-cleared region. `skip` is how many transcript values the claim covered.
            let skip = 0
            if (firstRun) {
                firstRun = false
                if (claimServerRegion && open !== null) {
                    skip = claimStreamedRegion(parent, open, blockEnd, source, options, items)
                    if (skip < 0) {
                        // Cold source, or a mismatch inside a claimed item: clear and re-paint as before.
                        for (const item of items) removeListItem(item)
                        items = []
                        clearBetween(open.nextSibling, blockEnd)
                        skip = 0
                    }
                }
            }
            untrack(() => {
                if (skip === 0) clearRun()
                let index = 0
                // A STREAMING RPC read is `Promise<AsyncIterable<C>>` (the memo read is async), and `for
                // await` cannot iterate a Promise; awaiting a non-thenable `gen()` is identity, so a plain
                // async-generator source is unchanged. Mirrors `toIterator`.
                void (async () => {
                    let iterable: AsyncIterable<unknown>
                    try {
                        iterable = (await source) as AsyncIterable<unknown>
                    } catch (error) {
                        if (!stale() && options.catch !== null)
                            catchDispose = options.catch(error)(parent, blockEnd)
                        return
                    }
                    try {
                        for await (const value of iterable) {
                            if (stale()) return
                            const at = index++
                            // Transcript indices are stable (the buffer is append-only), so skipping the
                            // claimed prefix by COUNT is exact — this cursor replays the same chunks the
                            // claim bound, in the same order.
                            if (at < skip) continue
                            const key = options.keyFor(value, at)
                            items.push(
                                createListItem(
                                    parent,
                                    blockEnd,
                                    value,
                                    at,
                                    key,
                                    options.createItem,
                                ),
                            )
                        }
                        // Stream drained — flip the `done(iterable)` probe (unless superseded first).
                        if (!stale()) markIterableDone(iterable)
                    } catch (error) {
                        if (stale()) return
                        // An errored stream is finished too, so `done(iterable)` observes completion.
                        markIterableDone(iterable)
                        if (options.catch !== null)
                            catchDispose = options.catch(error)(parent, blockEnd)
                    }
                })()
            })
            // Cleanup: bump the generation so any in-flight drain from this run stops appending. The DOM
            // teardown runs in the NEXT run's `clearRun` (and in the final dispose below).
            return () => {
                generation++
            }
        })
        return () => {
            stop()
            clearRun()
            remove(blockEnd)
        }
    }

    // Recovery flag: a HYDRATION mismatch inside a claimed item degrades the WHOLE list to create-mode
    // (the cursor is desynced once one item's structure is wrong, so per-item recovery isn't sound here).
    let recovered = false
    if (hydrating) {
        requireOpen(open, '{#for}')
        try {
            // Claim each server-rendered item run in place. The server concatenates item bodies with NO
            // per-item boundaries, so we bracket each with the SAME `<!--for-->`/`<!--/for-->` markers the
            // create path uses: seed the cursor, insert the start marker, let the item body claim (advancing
            // the cursor past exactly its nodes — bounded via the `hydrateForItem` flag), then close it off.
            hydrateSeek(open !== null ? open.nextSibling : null)
            const raw = untrack(() => options.read())
            const list = toItemArray(raw)
            for (let index = 0; index < list.length; index++) {
                const value = list[index]
                const key = options.keyFor(value, index)
                const startMarker = document.createComment('for')
                insert(parent, startMarker, hydrateNode())
                const endMarker = document.createComment('/for')
                beginForItem()
                const handle = options.createItem(parent, startMarker, endMarker, value, index)
                insert(parent, endMarker, hydrateNode())
                items.push({ key, startMarker, endMarker, handle, reused: false })
            }
        } catch (error) {
            if (!(error instanceof HydrationMismatch)) throw error
            warnHydrationMismatch('{#for}', error)
            for (const item of items) removeListItem(item)
            items = []
            clearBetween(open !== null ? open.nextSibling : null, blockEnd)
            recovered = true
        }
    }

    const dispose = effect(() => {
        const raw = options.read()
        const list = toItemArray(raw)
        if (recovered) {
            // Rebuild the cleared list from scratch (hydration OFF so items CLONE rather than mis-claim).
            recovered = false
            untrack(() => inCreateMode(() => reconcile(list)))
            return
        }
        untrack(() => reconcile(list))
    })

    return () => {
        dispose()
        for (const item of items) removeListItem(item)
        remove(blockEnd)
    }

    function reconcile(list: unknown[]): void {
        // One index of the reusable old items, and one scratch flag per item — no `used` Set and no
        // `kept` Set. Claiming a key DELETES it from the index, which is what stops a non-unique `by`
        // key from reusing the same item twice (the old `used` Set's job).
        const oldMap = new Map<unknown, ListItem>()
        for (const item of items) {
            item.reused = false
            if (!oldMap.has(item.key)) oldMap.set(item.key, item)
        }
        const nextItems: ListItem[] = []

        for (let index = 0; index < list.length; index++) {
            const value = list[index]
            const key = options.keyFor(value, index)
            const existing = oldMap.get(key)
            if (existing !== undefined) {
                oldMap.delete(key) // claimed — a repeat of this key must build a fresh item
                existing.reused = true
                existing.handle.update(value, index)
                nextItems.push(existing)
            } else {
                nextItems.push(
                    createListItem(parent, blockEnd, value, index, key, options.createItem),
                )
            }
        }

        // Remove by ITEM IDENTITY, not by key: with a non-unique `by` key, two old items can share a
        // key while only one was reused into `nextItems`. A key-based check would spare BOTH, stranding
        // the un-reused duplicate in the DOM (never updated, never disposed). The per-item flag carries
        // that identity directly — a fresh item is never in `items`, so it is never a removal candidate.
        for (const item of items) {
            if (!item.reused) removeListItem(item)
        }

        // Reorder DOM to match nextItems (walk back-to-front, moving out-of-place ranges).
        let reference: Node = blockEnd
        for (let index = nextItems.length - 1; index >= 0; index--) {
            const item = nextItems[index]
            if (item === undefined) continue
            if (item.endMarker.nextSibling !== reference) {
                moveRange(parent, item.startMarker, item.endMarker, reference)
            }
            reference = item.startMarker
        }

        items = nextItems
    }
}
