import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Keyed list binding — the runtime for `<template each key=>`. Rows live in their own
region, bounded by a trailing anchor so positioning is relative to the each itself,
never `parent.firstChild` — a sibling before the each (e.g. a static nav link) must
not be treated as the first row. An effect tracks `items()` and reconciles by key:
a new key renders a row in its own ownership scope (so the row's bindings dispose
when it leaves), surviving rows are moved before the anchor in list order, and a
departed key disposes and is removed. Keying by identity (not index) lets a row
keep its node and inner effects across a reorder.

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
        const present = new Set<string>()
        for (const item of list) {
            const key = keyOf(item)
            present.add(key)
            let row = rows.get(key)
            if (row === undefined) {
                row = buildRow(item)
                rows.set(key, row)
            }
            /* Place before the anchor in list order — appends a new row, moves a
               surviving one into sequence; positioning never touches preceding siblings. */
            parent.insertBefore(row.node, anchor)
        }
        for (const [key, row] of rows) {
            if (!present.has(key)) {
                row.dispose()
                parent.removeChild(row.node)
                rows.delete(key)
            }
        }
    })
}
