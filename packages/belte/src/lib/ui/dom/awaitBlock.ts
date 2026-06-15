import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { RESUME } from '../runtime/RESUME.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Async binding — the runtime for `<template await>`. Renders the pending branch,
then swaps to the resolved branch (with the value) or the error branch on settle.
Each branch builds in its own ownership scope, anchored for correct placement.

Hydration (the resume manifest): when adopting an SSR stream, the resolved value
was serialized into `RESUME[id]` (see `belte/ui/runtime/RESUME`). With an entry
present, the resolved branch the stream already swapped into the DOM is adopted in
place with the real value — no re-fetch, no flash. Without one (an await page not
delivered via the stream), the SSR boundary is discarded and the promise re-runs.

Cache-compatible by the warm-sync rule: `belte/shared/cache` returns a settled
value synchronously for a warm key and a Promise otherwise. A non-thenable result
renders the resolved branch immediately — no pending flash — matching the cache's
warm-read contract; only a real Promise shows pending and resolves on a microtask.
*/
// @readme plumbing
export function awaitBlock(
    parent: Node,
    id: number,
    promiseThunk: () => unknown,
    renderPending: ((parent: Node) => Node) | undefined,
    renderThen: (parent: Node, value: unknown) => Node,
    renderCatch: (parent: Node, error: unknown) => Node,
): void {
    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        /* Cursor sits on the `<!--belte:await:id-->` open marker. */
        const open = claimChild(hydration, parent)
        const entry = RESUME[id]
        if (entry !== undefined) {
            /* Adopt the streamed resolved branch in place, binding the value. */
            hydration.next.set(parent, open?.nextSibling ?? null)
            if (entry.ok) {
                renderThen(parent, entry.value)
            } else {
                renderCatch(parent, entry.error)
            }
            /* Cursor now sits on the close marker; step past it. */
            const close = claimChild(hydration, parent)
            hydration.next.set(parent, close?.nextSibling ?? null)
            return
        }
        /* No resume value: drop the SSR boundary and fall through to a fresh run. */
        discardBoundary(parent, open, `/belte:await:${id}`, hydration)
    }

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
        swap(() => renderThen(parent, result)) // warm-sync value → resolved now, no pending flash
        return
    }
    swap(renderPending === undefined ? undefined : () => renderPending(parent))
    ;(result as Promise<unknown>).then(
        (value) => swap(() => renderThen(parent, value)),
        (error) => swap(() => renderCatch(parent, error)),
    )
}

/* Remove the SSR boundary — open marker through close marker (inclusive) — and
   park the hydration cursor on the node after it, so a fresh run replaces it
   without duplicating the server's pending shell. */
function discardBoundary(
    parent: Node,
    open: Node | null,
    closeData: string,
    hydration: NonNullable<(typeof RENDER)['hydration']>,
): void {
    let node = open
    let after: Node | null = null
    while (node !== null) {
        const next = node.nextSibling
        const isClose = (node as { data?: string }).data === closeData
        parent.removeChild(node)
        if (isClose) {
            after = next
            break
        }
        node = next
    }
    hydration.next.set(parent, after)
}
