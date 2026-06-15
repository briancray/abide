import { effect } from '../effect.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Conditional binding — the runtime for `<template if>`. An effect tracks
`condition()`; on the truthy edge it renders the branch in its own ownership
scope and inserts it before a stable anchor (so it lands in the right place among
siblings), and on the falsy edge it disposes and removes it. A change that keeps
the condition truthy doesn't re-render — the branch persists and its own inner
bindings update. Single-element branch for now (it returns one node), mirroring
`each`'s row.
*/
// @readme plumbing
export function when(parent: Node, condition: () => unknown, render: () => Node): void {
    const anchor = document.createTextNode('')
    parent.appendChild(anchor)
    let active: EachRow | undefined
    effect(() => {
        if (condition()) {
            if (active === undefined) {
                let node: Node | undefined
                const dispose = scope(() => {
                    node = render()
                })
                active = { node: node as Node, dispose }
                parent.insertBefore(active.node, anchor)
            }
        } else if (active !== undefined) {
            active.dispose()
            parent.removeChild(active.node)
            active = undefined
        }
    })
}
