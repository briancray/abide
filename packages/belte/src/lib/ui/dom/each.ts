import { effect } from '../effect.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Keyed list binding — the runtime for `<template each key=>`. An effect tracks
`items()`; on change it reconciles the parent's children to the new sequence by
key: a new key renders a row in its own ownership scope (so the row's bindings
dispose when it leaves), a departed key disposes and is removed, and surviving
rows are moved into place with `insertBefore`. Keying by identity (not index) is
what lets a row keep its node and inner effects across a reorder — the same
reason the document addresses list entities by key, not position.
*/
// @readme plumbing
export function each<T>(
    parent: Node,
    items: () => T[],
    keyOf: (item: T) => string,
    render: (item: T) => Node,
): void {
    const rows = new Map<string, EachRow>()
    effect(() => {
        const list = items()
        const present = new Set<string>()
        /* anchor = the last node placed; the next row goes right after it. */
        let anchor: Node | null = null
        for (const item of list) {
            const key = keyOf(item)
            present.add(key)
            let row = rows.get(key)
            if (row === undefined) {
                let node: Node | undefined
                const dispose = scope(() => {
                    node = render(item)
                })
                row = { node: node as Node, dispose }
                rows.set(key, row)
            }
            const reference: Node | null = anchor === null ? parent.firstChild : anchor.nextSibling
            if (reference !== row.node) {
                parent.insertBefore(row.node, reference)
            }
            anchor = row.node
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
