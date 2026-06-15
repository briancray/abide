import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Async binding — the runtime for `<template await>`. Renders the pending branch,
then swaps to the resolved branch (with the value) or the error branch on settle.
Each branch builds in its own ownership scope, anchored for correct placement.

Cache-compatible by the warm-sync rule: `belte/shared/cache` returns a settled
value synchronously for a warm key and a Promise otherwise. A non-thenable result
renders the resolved branch immediately — no pending flash — matching the cache's
warm-read contract; only a real Promise shows pending and resolves on a microtask.
(SSR's await-vs-await-block streaming partition is a server concern, handled where
the renderer flushes — this is the client half.)
*/
// @readme plumbing
export function awaitBlock(
    parent: Node,
    promiseThunk: () => unknown,
    renderPending: (() => Node) | undefined,
    renderThen: (value: unknown) => Node,
    renderCatch: (error: unknown) => Node,
): void {
    const anchor = document.createTextNode('')
    parent.appendChild(anchor)
    let active: EachRow | undefined

    const swap = (render: (() => Node) | undefined): void => {
        if (active !== undefined) {
            active.dispose()
            parent.removeChild(active.node)
            active = undefined
        }
        if (render === undefined) {
            return
        }
        let node: Node | undefined
        const dispose = scope(() => {
            node = render()
        })
        active = { node: node as Node, dispose }
        parent.insertBefore(active.node, anchor)
    }

    const result = promiseThunk()
    if (result === null || typeof (result as { then?: unknown })?.then !== 'function') {
        swap(() => renderThen(result)) // warm-sync value → resolved now, no pending flash
        return
    }
    swap(renderPending)
    ;(result as Promise<unknown>).then(
        (value) => swap(() => renderThen(value)),
        (error) => swap(() => renderCatch(error)),
    )
}
