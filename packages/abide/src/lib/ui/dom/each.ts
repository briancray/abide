import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { claimExpected } from '../runtime/claimExpected.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import { enterNamespace } from './enterNamespace.ts'
import { moveRange } from './moveRange.ts'
import { removeRange } from './removeRange.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Keyed list binding — the runtime for `<template each key=>`. Each row is a content
RANGE bounded by two comment markers, so a row holds anything — elements,
components, text, nested control-flow — not just one node. Rows live before a
trailing anchor so positioning is relative to the each itself. An effect tracks
`items()` and reconciles by key: a new key builds a row in its own ownership scope,
a departed key disposes and its range is removed. Keying by identity lets a row
keep its range and inner effects across a reorder.

Placement walks the desired list *backwards* from the trailing anchor, holding a
cursor at the node each row should precede; a row already ending there is left
untouched, so a stable list does zero DOM moves and an append exactly one — only an
out-of-place row's range is moved. Departed rows are pruned *before* placement.

On hydrate the SSR rows are already in place and in order: each row claims its
markers and content where they sit (no reordering), the anchor parks after them,
and the first reconcile is skipped.
*/
// @documentation plumbing
export function each<T>(
    parent: Node,
    items: () => Iterable<T>,
    keyOf: (item: T) => string,
    render: (parent: Node, item: T) => void,
    before: Node | null = null,
): void {
    const rows = new Map<string, EachRow>()
    /* Each row's scope, registered with the owner so every live row disposes on owner
       teardown (the effect's own disposer only unsubscribes it from `items()`). */
    const group = scopeGroup()

    /* Build a row's range. Hydrate mode (only while the claim cursor is active —
       read fresh, since a row built by a post-hydration reconcile must create, not
       claim): claim the start marker, build content in place, claim the end marker.
       Create mode: markers + content in a fragment, held in `pending` until placement
       inserts it. */
    /* Reconcile runs inside the effect below; the row build doesn't subscribe it
       (`scope` builds untracked), so a raw reactive read in the row content — e.g. a
       nested `<script>` body — can't re-reconcile the whole list. Only `items()` drives
       the each; each row's own interpolations track through their own effects. */
    const buildRow = (item: T): EachRow => {
        const hydration = RENDER.hydration
        if (hydration !== undefined) {
            const start = claimExpected(hydration, parent, 'each row start marker')
            hydration.next.set(parent, start.nextSibling)
            const dispose = group.track(scope(() => render(parent, item)))
            const end = claimExpected(hydration, parent, 'each row end marker')
            hydration.next.set(parent, end.nextSibling)
            return { start, end, dispose }
        }
        const start = document.createComment('[')
        const end = document.createComment(']')
        const pending = document.createDocumentFragment()
        pending.appendChild(start)
        /* Build under `parent`'s foreign namespace so foreign row elements (svg/math)
           built into the detached fragment are namespaced, not built as HTML. */
        const dispose = group.track(
            enterNamespace(parent, () => scope(() => render(pending, item))),
        )
        pending.appendChild(end)
        return { start, end, dispose, pending }
    }

    /* Place a row so its range ends just before `cursor`: insert a fresh row's
       fragment, or move an existing range only when it isn't already there. Insert
       via `cursor`'s LIVE parent, not the captured `parent` — when this `each` is a
       bare child of a control-flow branch, `parent` is the branch's build fragment,
       which the enclosing block has since emptied into the document. */
    const placeBefore = (row: EachRow, cursor: Node): void => {
        if (row.pending !== undefined) {
            ;(cursor.parentNode ?? parent).insertBefore(row.pending, cursor)
            row.pending = undefined
            return
        }
        if (row.end.nextSibling !== cursor) {
            moveRange(row.start, row.end, cursor)
        }
    }

    let anchor: Node
    /* When hydrating, the first effect run must NOT reconcile — the rows it would
       build are already adopted in place below. */
    let adopting = false
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        for (const item of items()) {
            rows.set(keyOf(item), buildRow(item)) // claims the SSR row where it sits
        }
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, claimChild(hydration, parent))
        adopting = true
    } else {
        anchor = document.createTextNode('')
        /* `before` (a static node located by the skeleton) places the row anchor among
           siblings on create, so rows land before a static suffix; null appends (tail). */
        parent.insertBefore(anchor, before)
    }

    effect(() => {
        /* Read (subscribe) every run, including the adopting one. Materialize a
           non-array iterable to an array so a generator yields fresh each run. */
        const source = items()
        if (adopting) {
            adopting = false // rows already adopted in document order; nothing to move
            return
        }
        /* All SSR rows were adopted in the pre-effect loop, so every reconcile build is
           create mode. Clear the global claim cursor for the duration: a synchronous
           write that reconciles *mid-hydrate* (RENDER.hydration still active — e.g. a
           page setting shared state during the hydrate pass) would otherwise make
           buildRow and its inner row render claim SSR nodes that don't exist for a
           freshly keyed row. The same `next` Map is restored, so the outer hydration
           cursor is untouched (mirrors awaitBlock/tryBlock). */
        const previousHydration = RENDER.hydration
        RENDER.hydration = undefined
        try {
            const list = Array.isArray(source) ? source : [...source]
            const keys = list.map(keyOf)
            const present = new Set(keys)
            /* Prune departed rows first so their ranges don't sit between survivors and
               throw off the in-place sibling checks below. */
            for (const [key, row] of rows) {
                if (!present.has(key)) {
                    row.dispose()
                    removeRange(row.start, row.end)
                    rows.delete(key)
                }
            }
            /* Walk backwards from the anchor: `cursor` is the node the current row must
               precede. A row already ending there keeps its place; only out-of-order (or
               freshly built) rows move. */
            let cursor: Node = anchor
            for (let index = list.length - 1; index >= 0; index -= 1) {
                const key = keys[index] as string
                let row = rows.get(key)
                if (row === undefined) {
                    row = buildRow(list[index] as T)
                    rows.set(key, row)
                }
                placeBefore(row, cursor)
                cursor = row.start
            }
        } finally {
            RENDER.hydration = previousHydration
        }
    })
}
