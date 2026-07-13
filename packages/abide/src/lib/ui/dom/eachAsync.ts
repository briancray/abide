import { effect } from '../effect.ts'
import { CURRENT_BOUNDARY } from '../runtime/CURRENT_BOUNDARY.ts'
import { CURRENT_PATH } from '../runtime/CURRENT_PATH.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { generationGuard } from '../runtime/generationGuard.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import type { State } from '../runtime/types/State.ts'
import { withPathFrom } from '../runtime/withPathFrom.ts'
import { state } from '../state.ts'
import { buildDetachedRange } from './buildDetachedRange.ts'
import { removeRange } from './removeRange.ts'
import type { EachRow } from './types/EachRow.ts'
import { withSuspense } from './withSuspense.ts'

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
    /* The row receives its item and position as reactive cells — same contract as sync
       `each`; the streaming runtime rebuilds the row on a re-yield rather than patching, and
       the position is the stream arrival ordinal (a stream only appends, never reorders). */
    render: (parent: Node, item: State<T>, index: State<number>) => void,
    /* Absent → an iterator rejection routes to the enclosing {#try} boundary captured at build
       (if any), else surfaces, instead of rendering a catch branch. */
    renderCatch: ((parent: Node, error: unknown) => void) | undefined,
    before: Node | null = null,
    /* Explicit `by` key → the row keys its render-path segment on the stable key; else on the
       stream arrival ordinal (a stream only appends, so the ordinal is stable). */
    keyed = false,
): void {
    const rows = new Map<string, EachRow>()
    /* This each's render-path ancestry, captured at build; each row builds under
       `basePath/segment` so a component/cell in a streamed row gets a stable id even though the
       row arrives after the ambient path is gone. */
    const basePath = CURRENT_PATH.current
    /* The enclosing {#try} boundary ambient at BUILD (see `awaitBlock`). A catch-less rejection
       arrives LATER from the async drain, after CURRENT_BOUNDARY has been restored, so capture
       it into this closure now rather than read it at settle time. */
    const capturedBoundary = CURRENT_BOUNDARY.current
    /* Each row's (and the error branch's) scope, registered with the owner so they
       dispose on owner teardown; the block's own teardown only stops the stream. */
    const group = scopeGroup()
    const hydration = RENDER.hydration
    const anchor = document.createTextNode('')
    if (hydration !== undefined) {
        parent.insertBefore(anchor, claimChild(hydration, parent)) // no server rows to claim
    } else {
        parent.insertBefore(anchor, before) // `before` places rows before a static suffix
    }

    /* Build a content range (the shared detached-range create primitive) and insert it
       just before the anchor (arrival order). A bare range (no item cell) — the data-row
       site adds the cell, the error branch needs none. */
    const insertRange = (
        build: (into: Node) => void,
    ): { start: Node; end: Node; dispose: () => void } => {
        /* Namespace the build off the anchor's LIVE parent, and insert there too: when this
           `each` is a bare child of a control-flow branch, the captured `parent` is the
           branch's build fragment, emptied into the document once the enclosing block
           placed it. */
        const host = anchor.parentNode ?? parent
        const { start, end, fragment, dispose } = buildDetachedRange(host, build)
        host.insertBefore(fragment, anchor)
        return { start, end, dispose: group.track(dispose) }
    }

    /* The mounted `<template catch>` range, disposed when a fresh run re-streams. */
    let errorRange: { start: Node; end: Node; dispose: () => void } | undefined
    const clearError = (): void => {
        if (errorRange !== undefined) {
            errorRange.dispose()
            removeRange(errorRange.start, errorRange.end)
            errorRange = undefined
        }
    }

    let iterator: AsyncIterator<T> | undefined
    /* Bumped each run so a superseded drain stops appending and pruning, and on owner teardown
       — which also `return()`s the live iterator to release the source (rows and the error
       branch are disposed by the group, whose scopes were tracked). */
    const guard = generationGuard(() => {
        iterator?.return?.(undefined)?.catch(() => undefined)
        iterator = undefined
    })
    effect(() => {
        const generationAtStart = guard.renew()
        iterator?.return?.(undefined)?.catch(() => undefined) // close the superseded run's iterator before re-streaming
        iterator = undefined
        clearError() // a fresh run drops a prior error branch
        /* A reseed streams a FRESH source (e.g. `room(newId)`), so the prior run's rows are stale.
           Drop them now rather than relying on the drain's completion prune below — a never-
           completing source (a socket) never reaches that prune, so a key the new stream doesn't
           re-yield would otherwise leak in the DOM and the `rows` map forever (and mix the old
           source's rows in with the new). Keys the new stream does re-yield rebuild fresh (the
           block rebuilds on every re-yield regardless), so nothing reusable is lost. */
        for (const [, row] of rows) {
            row.dispose()
            removeRange(row.start, row.end)
        }
        rows.clear()
        /* Read (subscribe) the source synchronously, tolerating a pending blocking `await` read
           embedded in it (a SuspenseSignal, ADR-0042): withhold — render no rows until it resolves,
           exactly as sync `each` does. On a cold client render the read runs here at build; the
           read tracked its cell, so this effect re-runs on settle. */
        const iterable = withSuspense<AsyncIterable<T> | undefined>(items, undefined)
        if (iterable === undefined) {
            return
        }
        const present = new Set<string>()
        let arrivals = 0 // stream arrival ordinal → each row's index
        const drain = async (): Promise<void> => {
            const active = iterable[Symbol.asyncIterator]()
            iterator = active
            while (true) {
                const result = await active.next()
                /* A re-run or teardown bumped the generation while we awaited. */
                if (!guard.live(generationAtStart)) {
                    return
                }
                if (result.done === true) {
                    break
                }
                const key = keyOf(result.value)
                present.add(key)
                /* A re-yielded key rebuilds the row from the new value (arrival order), swapping
                   the old range out. The item rides in a cell — the row reads it reactively, same
                   contract as sync `each` — but the streaming runtime rebuilds rather than patches. */
                const stale = rows.get(key)
                const cell = state(result.value) as State<unknown>
                const indexCell = state(arrivals)
                const segment = keyed ? key : arrivals
                arrivals += 1
                rows.set(key, {
                    ...insertRange((host) =>
                        withPathFrom(basePath, segment, () =>
                            render(host, cell as State<T>, indexCell),
                        ),
                    ),
                    cell,
                    indexCell,
                })
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
            if (!guard.live(generationAtStart)) {
                return
            }
            /* No catch branch → route to the enclosing {#try} boundary captured at build if one
               was ambient; otherwise surface the rejection (mirrors `<template await>`). */
            if (renderCatch === undefined) {
                if (capturedBoundary !== undefined) {
                    capturedBoundary.handle(error)
                    return
                }
                throw error
            }
            /* Keep the streamed rows; render the catch branch after them, at the anchor. */
            errorRange = insertRange((host) => renderCatch(host, error))
        })
    })
}
