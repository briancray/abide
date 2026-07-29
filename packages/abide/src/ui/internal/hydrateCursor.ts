// THE HYDRATION CURSOR — the three-variable state machine the whole runtime consults.
//
// `hydrating` is a MODE, not a peer of `ifBlock`: 45 places in the runtime read it, and everything in
// this module exists only while it is true. It has three pieces of module-level mutable state
// (`hydrating`, `hydrateCursor`, `hydrateForItem`) written in exactly four places — `startHydration`,
// `endHydration`, and the save/restore inside `inCreateMode` — and read everywhere else.
//
// Split out because it is a state machine with no test. NO test file in the repo imports `runtime.ts`,
// so every hydration-cursor behaviour was reachable only through `emitHydrate.test.ts`, which compiles
// a template, emits client code, evals it and drives a happy-dom host — a test of the emitter, the
// runtime and this cursor at once. Someone had already needed the seam and faked it:
// `seededState.ts` takes `isHydrating: () => boolean = () => true` as an INJECTED PARAMETER WITH A
// DEFAULT, wired to the real flag by `bootstrap.ts`, for exactly one reason — `seededState.test.ts`
// cannot import `runtime.ts`.
//
// `runtime.ts` re-exports everything here, so the emitted `$rt.*` ABI is unchanged. `hydrating` is a
// live ESM binding, so a re-export reads the current value rather than a snapshot.

import { BLOCK_ANCHOR } from './BLOCK_ANCHOR.ts'
import { remove } from './domOps.ts'
import { HTML_ANCHOR } from './HTML_ANCHOR.ts'

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

export const ELEMENT_NODE = 1
export const TEXT_NODE = 3
export const COMMENT_NODE = 8

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
// Comment-anchor conventions (emitted identically by `templatePlan`/`emitServer`; the block pair's
// values come from the shared `BLOCK_ANCHOR`, which is what makes "identically" a fact rather than a
// promise):
//   • `<!---->`    (empty data)  — a leaf slot anchor (scalar interp / await / html).
//   • `<!--[-->`   (data "[")    — a block/component OPEN anchor. A component subtree ALWAYS arrives through
//                                  a component slot (`<Name/>`, `<slot/>`, `{children()}`), never an
//                                  interpolation — so a leaf position is always a scalar.
//   • `<!--]-->`   (data "]")    — the matching CLOSE anchor.
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
            if (value === BLOCK_ANCHOR.open) depth++
            else if (value === BLOCK_ANCHOR.close) {
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
export function clearBetween(start: Node | null, end: Node | null): void {
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
