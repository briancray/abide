import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { enterNamespace } from './enterNamespace.ts'
import { removeRange } from './removeRange.ts'
import type { EachRow } from './types/EachRow.ts'

/*
Async keyed list — the runtime for `<template each await key=>`. Like `each`, but
over an AsyncIterable: rows append and reconcile by key as the iterator yields. Each
row is a content RANGE bounded by comment markers, so a row holds any content.

SSR renders no rows — async sources are client-time — so hydration just parks the
anchor before the next sibling (like an empty sync each) and the client drains the
iterable. A reactive re-run bumps the generation so a prior in-flight drain stops
appending; departed keys are pruned once a drain completes.

On a mid-stream rejection the already-streamed rows stay and the `<template catch>`
branch (`renderCatch`) renders after them; absent a catch branch the rejection
surfaces (re-throws), mirroring `<template await>`.
*/
// @documentation plumbing
export function eachAsync<T>(
    parent: Node,
    items: () => AsyncIterable<T>,
    keyOf: (item: T) => string,
    render: (parent: Node, item: T) => void,
    /* Absent → an iterator rejection surfaces instead of rendering a catch branch. */
    renderCatch: ((parent: Node, error: unknown) => void) | undefined,
    before: Node | null = null,
): void {
    const rows = new Map<string, EachRow>()
    const hydration = RENDER.hydration
    const anchor = document.createTextNode('')
    if (hydration !== undefined) {
        parent.insertBefore(anchor, claimChild(hydration, parent)) // no server rows to claim
    } else {
        parent.insertBefore(anchor, before) // `before` places rows before a static suffix
    }

    /* Build a content range and insert it just before the anchor (arrival order). */
    const insertRange = (build: (into: Node) => void): EachRow => {
        const start = document.createComment('[')
        const end = document.createComment(']')
        const fragment = document.createDocumentFragment()
        fragment.appendChild(start)
        const dispose = enterNamespace(anchor.parentNode ?? parent, () =>
            scope(() => build(fragment)),
        )
        fragment.appendChild(end)
        /* Insert via the anchor's LIVE parent: when this `each` is a bare child of a
           control-flow branch, the captured `parent` is the branch's build fragment,
           emptied into the document once the enclosing block placed it. */
        ;(anchor.parentNode ?? parent).insertBefore(fragment, anchor)
        return { start, end, dispose }
    }

    /* The mounted `<template catch>` range, disposed when a fresh run re-streams. */
    let errorRange: EachRow | undefined
    const clearError = (): void => {
        if (errorRange !== undefined) {
            errorRange.dispose()
            removeRange(errorRange.start, errorRange.end)
            errorRange = undefined
        }
    }

    /* Bumped each run so a superseded drain stops appending and pruning. */
    let generation = 0
    let iterator: AsyncIterator<T> | undefined
    effect(() => {
        generation += 1
        const generationAtStart = generation
        iterator?.return?.(undefined)?.catch(() => undefined) // close the superseded run's iterator before re-streaming
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
                   range out (v1 has no in-place field patch — rows bind plain snapshots). */
                const stale = rows.get(key)
                const item = result.value
                rows.set(
                    key,
                    insertRange((host) => render(host, item)),
                )
                if (stale !== undefined) {
                    stale.dispose()
                    removeRange(stale.start, stale.end)
                }
            }
            for (const [key, row] of rows) {
                if (!present.has(key)) {
                    row.dispose()
                    removeRange(row.start, row.end)
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
            errorRange = insertRange((host) => renderCatch(host, error))
        })
    })

    /* Stop the live stream when the enclosing scope tears down: bump the generation so
       the drain abandons its loop, `return()` the iterator to release the source, drop
       the error branch, and dispose every surviving row. */
    if (OWNER.current !== undefined) {
        OWNER.current.push(() => {
            generation += 1
            iterator?.return?.(undefined)?.catch(() => undefined)
            iterator = undefined
            clearError()
            for (const row of rows.values()) {
                row.dispose()
            }
            rows.clear()
        })
    }
}
