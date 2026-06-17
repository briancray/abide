import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Async keyed list — the runtime for `<template each await key=>`. Like `each`, but
over an AsyncIterable: rows append and reconcile by key as the iterator yields, so
a live stream (an `async function*` rpc, a socket feed) lands row by row. Keying by
identity lets a re-yielded key reuse its node and inner effects rather than append a
duplicate.

SSR renders no rows — async sources are client-time (an infinite stream would hang
SSR) — so hydration just parks the anchor before the next sibling (like an empty
sync each) and the client drains the iterable. A reactive re-run (a cache
invalidate, or the iterable expression changing) bumps the generation so a prior
in-flight drain stops appending; departed keys are pruned once a drain completes
(an infinite stream never prunes — rows accumulate / update in place).

On a mid-stream rejection the already-streamed rows stay and the `<template catch>`
branch (`renderCatch`) renders after them; absent a catch branch the rejection
surfaces (re-throws) instead of being swallowed (mirrors `<template await>`).
*/
// @readme plumbing
export function eachAsync<T>(
    parent: Node,
    items: () => AsyncIterable<T>,
    keyOf: (item: T) => string,
    render: (parent: Node, item: T) => Node,
    /* Absent → an iterator rejection surfaces instead of rendering a catch branch. */
    renderCatch: ((parent: Node, error: unknown) => Node[]) | undefined,
): void {
    const rows = new Map<string, EachRow>()

    /* Build one row in its own scope so its bindings dispose when it leaves. Rows are
       always created (never on the server), so this runs after hydration has ended. */
    const buildRow = (item: T): EachRow => {
        let node: Node | undefined
        const dispose = scope(() => {
            node = render(parent, item)
        })
        return { node: node as Node, dispose }
    }

    const hydration = RENDER.hydration
    const anchor = document.createTextNode('')
    if (hydration !== undefined) {
        parent.insertBefore(anchor, claimChild(hydration, parent)) // no server rows to claim
    } else {
        parent.appendChild(anchor)
    }

    /* The mounted `<template catch>` range, disposed when a fresh run re-streams. */
    let errorRange: { nodes: Node[]; dispose: () => void } | undefined
    const clearError = (): void => {
        if (errorRange !== undefined) {
            errorRange.dispose()
            for (const node of errorRange.nodes) {
                parent.removeChild(node)
            }
            errorRange = undefined
        }
    }

    /* Bumped each run so a superseded drain stops appending and pruning. */
    let generation = 0
    /* The live iterator, held so a re-run or teardown can `return()` it — closing
       the source (a generator's `finally`, a socket) and resolving any pending
       `next()`. Bumping `generation` alone can't reach a drain parked on `await
       iterator.next()`: an idle infinite stream never yields again, so the loop
       never re-checks `generation` — it dangles on the microtask queue forever. */
    let iterator: AsyncIterator<T> | undefined
    effect(() => {
        generation += 1
        const generationAtStart = generation
        iterator?.return?.() // close the superseded run's iterator before re-streaming
        iterator = undefined
        clearError() // a fresh run drops a prior error branch
        const iterable = items() // read (subscribe) synchronously
        const present = new Set<string>()
        const drain = async (): Promise<void> => {
            const active = iterable[Symbol.asyncIterator]()
            iterator = active
            while (true) {
                const result = await active.next()
                /* A re-run or teardown bumped the generation while we awaited. */
                if (generationAtStart !== generation) {
                    return
                }
                if (result.done === true) {
                    break
                }
                const key = keyOf(result.value)
                present.add(key)
                /* A re-yielded key rebuilds the row from the new value, swapping the old
                   node out (v1 has no in-place field patch — rows bind plain snapshots). */
                const stale = rows.get(key)
                const row = buildRow(result.value)
                rows.set(key, row)
                if (stale !== undefined) {
                    stale.dispose()
                    parent.removeChild(stale.node)
                }
                parent.insertBefore(row.node, anchor) // arrival order, before the anchor
            }
            for (const [key, row] of rows) {
                if (!present.has(key)) {
                    row.dispose()
                    parent.removeChild(row.node)
                    rows.delete(key)
                }
            }
        }
        drain().catch((error: unknown) => {
            if (generationAtStart !== generation) {
                return
            }
            /* No catch branch → surface the rejection (mirrors `<template await>`). */
            if (renderCatch === undefined) {
                throw error
            }
            /* Keep the streamed rows; render the catch branch after them, at the anchor. */
            let nodes: Node[] = []
            const dispose = scope(() => {
                nodes = renderCatch(parent, error)
            })
            for (const node of nodes) {
                parent.insertBefore(node, anchor)
            }
            errorRange = { nodes, dispose }
        })
    })

    /* Stop the live stream when the enclosing scope tears down. The effect's own
       disposer only unsubscribes from `items()` — it leaves the running `drain()`
       pulling rows into a now-detached parent forever. Bump the generation so the
       drain abandons its loop, `return()` the iterator to release the source and any
       pending `next()`, drop the error branch, and dispose every surviving row. */
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => {
            generation += 1
            iterator?.return?.()
            iterator = undefined
            clearError()
            for (const row of rows.values()) {
                row.dispose()
            }
            rows.clear()
        })
    }
}
