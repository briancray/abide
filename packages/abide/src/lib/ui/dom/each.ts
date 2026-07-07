import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { claimExpected } from '../runtime/claimExpected.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import type { State } from '../runtime/types/State.ts'
import { state } from '../state.ts'
import { buildDetachedRange } from './buildDetachedRange.ts'
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
    /* The row receives its item and its position as reactive cells (not raw snapshots): a
       re-key with a changed value, or a reorder that shifts the row, sets the matching cell
       and re-runs the row's effects in place. The compiler binds the `as`/`index` names to
       read them; a direct caller reads `item.value` / `index.value`. */
    render: (parent: Node, item: State<T>, index: State<number>) => void,
    before: Node | null = null,
): void {
    const rows = new Map<string, EachRow>()
    /* Monotonic reconcile-pass id. Each reconcile stamps every surviving row with the
       current pass, so prune is a `row.gen !== pass` int compare instead of building a
       `Set` of present keys every reconcile. */
    let generation = 0
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
    const buildRow = (item: T, position: number): EachRow => {
        /* Item and position are held in reactive cells the row reads, so a later re-key with
           a changed value, or a reorder that shifts the row, updates it in place (see the
           reconcile below) instead of rebuilding it. */
        const cell = state(item) as State<unknown>
        const indexCell = state(position)
        const hydration = RENDER.hydration
        if (hydration !== undefined) {
            const start = claimExpected(hydration, parent, 'each row start marker')
            hydration.next.set(parent, start.nextSibling)
            const dispose = group.track(scope(() => render(parent, cell as State<T>, indexCell)))
            const end = claimExpected(hydration, parent, 'each row end marker')
            hydration.next.set(parent, end.nextSibling)
            return { start, end, dispose, cell, indexCell }
        }
        /* Shared detached-range create primitive: a `[ … ]` fragment built under `parent`'s
           foreign namespace (so svg/math row children are namespaced, not built as HTML),
           held in `pending` until placement inserts it. */
        const { start, end, fragment, dispose } = buildDetachedRange(parent, (host) =>
            render(host, cell as State<T>, indexCell),
        )
        return { start, end, dispose: group.track(dispose), cell, indexCell, pending: fragment }
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
        let position = 0
        for (const item of items()) {
            const key = keyOf(item)
            const row = buildRow(item, position) // claims the SSR row where it sits
            if (rows.has(key)) {
                /* Duplicate key: this row already claimed its SSR markers, but the map holds
                   one row per key (create mode keeps the FIRST built row too). Dispose+remove
                   this later duplicate so it isn't orphaned on screen forever — the reconcile
                   prune only reaches rows still in the map. */
                row.dispose()
                removeRange(row.start, row.end)
            } else {
                rows.set(key, row)
            }
            position += 1
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
            generation += 1
            const pass = generation
            /* Resolve each desired key to its surviving row once, here, stamping it with
               this pass — so prune below is an int compare (no `Set`) and the placement
               walk reuses the resolved row instead of a second `rows.get`. Halving the map
               lookups per reconcile is a real win once the harness's O(n) `nextSibling` no
               longer swamps it. `undefined` marks a key with no surviving row — a build. */
            const resolved: (EachRow | undefined)[] = new Array(keys.length)
            for (let index = 0; index < keys.length; index += 1) {
                const row = rows.get(keys[index] as string)
                if (row !== undefined) {
                    row.gen = pass
                }
                resolved[index] = row
            }
            /* Prune departed rows first (those the resolve loop didn't reach this pass) so
               their ranges don't sit between survivors and throw off the in-place sibling
               checks below. */
            for (const [key, row] of rows) {
                if (row.gen !== pass) {
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
                let row = resolved[index]
                if (row === undefined) {
                    /* Duplicate key within this list: a row for this key was already built
                       earlier in this pass. Building another and rows.set-ing it would
                       overwrite the map entry for the first, orphaning it — the prune loop
                       only reaches rows still in the map, so it would leak on screen forever.
                       Collapse to one row (like the hydration path above), skipping this
                       index rather than inserting an unreachable duplicate. */
                    const built = rows.get(keys[index] as string)
                    if (built !== undefined && built.gen === pass) {
                        continue
                    }
                    row = buildRow(list[index] as T, index)
                    row.gen = pass
                    rows.set(keys[index] as string, row)
                } else {
                    /* Surviving key: push the (possibly new) item and position into the row's
                       cells. Both write through `Object.is`, so an unchanged item/position is a
                       no-op and a changed one re-runs only the row's own effects — the row's DOM
                       is never rebuilt. A reorder thus repaints only the moved rows' `index`. */
                    row.cell.value = list[index]
                    row.indexCell.value = index
                }
                placeBefore(row, cursor)
                cursor = row.start
            }
        } finally {
            RENDER.hydration = previousHydration
        }
    })
}
