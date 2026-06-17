import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Keyed list binding — the runtime for `<template each key=>`. Rows live in their own
region, bounded by a trailing anchor so positioning is relative to the each itself,
never `parent.firstChild` — a sibling before the each (e.g. a static nav link) must
not be treated as the first row. An effect tracks `items()` and reconciles by key:
a new key renders a row in its own ownership scope (so the row's bindings dispose
when it leaves), and a departed key disposes and is removed. Keying by identity
(not index) lets a row keep its node and inner effects across a reorder.

Placement walks the desired list *backwards* from the trailing anchor, holding a
cursor at the node each row should precede; a row already sitting there is left
untouched, so a stable list does zero DOM moves and an append does exactly one —
only out-of-place rows are re-inserted (`insertBefore` on an in-place node would
otherwise remove-then-reinsert it, O(rows) moves per change). Departed rows are
pruned *before* placement so their nodes can't shift the cursor's sibling checks.

On hydrate the SSR rows are already in place and in order: claim each one where it
sits (no reordering), park the anchor after them, and skip the first reconcile.
*/
// @readme plumbing
export function each<T>(
    parent: Node,
    items: () => Iterable<T>,
    keyOf: (item: T) => string,
    render: (parent: Node, item: T) => Node,
): void {
    const rows = new Map<string, EachRow>()

    /* Build one row in its own scope (render claims on hydrate, creates otherwise). */
    const buildRow = (item: T): EachRow => {
        let node: Node | undefined
        const dispose = scope(() => {
            node = render(parent, item)
        })
        return { node: node as Node, dispose }
    }

    const hydration = RENDER.hydration
    let anchor: Node
    /* When hydrating, the first effect run must NOT reconcile — the rows it would
       build are already adopted in place below. */
    let adopting = false
    if (hydration !== undefined) {
        for (const item of items()) {
            rows.set(keyOf(item), buildRow(item)) // claims the SSR row where it sits
        }
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, claimChild(hydration, parent))
        adopting = true
    } else {
        anchor = document.createTextNode('')
        parent.appendChild(anchor)
    }

    effect(() => {
        /* Read (subscribe) every run, including the adopting one. Materialize a
           non-array iterable to an array so a generator yields fresh each run and the
           list can be safely traversed once for placement, once for pruning. */
        const source = items()
        if (adopting) {
            adopting = false // rows already adopted in document order; nothing to move
            return
        }
        const list = Array.isArray(source) ? source : [...source]
        const keys = list.map(keyOf)
        const present = new Set(keys)
        /* Prune departed rows first so their nodes don't sit between survivors and
           throw off the in-place sibling checks below. */
        for (const [key, row] of rows) {
            if (!present.has(key)) {
                row.dispose()
                parent.removeChild(row.node)
                rows.delete(key)
            }
        }
        /* Walk backwards from the anchor: `cursor` is the node the current row must
           precede. A row already there keeps its place; only an out-of-order (or
           freshly built) row is moved. Placement never touches preceding siblings. */
        let cursor: Node = anchor
        for (let index = list.length - 1; index >= 0; index -= 1) {
            const key = keys[index] as string
            let row = rows.get(key)
            if (row === undefined) {
                row = buildRow(list[index] as T)
                rows.set(key, row)
            }
            if (row.node.nextSibling !== cursor) {
                parent.insertBefore(row.node, cursor)
            }
            cursor = row.node
        }
    })

    /* Dispose every row still live when the enclosing scope tears down. The effect's
       own disposer only unsubscribes it from `items()`; it never reaches the per-row
       ownership scopes, which are pruned only on the departed-key path above. Without
       this, a row whose binding subscribes to a longer-lived signal (a module store,
       the cache, `page`) stays in that signal's observers after the list unmounts. The
       host's DOM is cleared by `mount`, so disposal need not remove the nodes. */
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => {
            for (const row of rows.values()) {
                row.dispose()
            }
            rows.clear()
        })
    }
}
