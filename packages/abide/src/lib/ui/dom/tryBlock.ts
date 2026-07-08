import { effect } from '../effect.ts'
import { AsyncCellError } from '../runtime/AsyncCellError.ts'
import { CURRENT_BOUNDARY } from '../runtime/CURRENT_BOUNDARY.ts'
import { claimExpected } from '../runtime/claimExpected.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import type { Boundary } from '../runtime/types/Boundary.ts'
import { withoutHydration } from '../runtime/withoutHydration.ts'
import { buildDetachedRange } from './buildDetachedRange.ts'
import { discardBoundary } from './discardBoundary.ts'
import { removeRange } from './removeRange.ts'

/*
Reactive error boundary — the runtime for `<template try>` (ADR-0019 D3). Unlike the old
synchronous render-once version it is render-MANY and reactive both directions: it catches
a build throw AND an initial reactive-read throw (as before) AND — the headline capability
— a throw from a LATER re-run, where an async error lives (an async cell that rejects after
mount, read via a throwing peek → `AsyncCellError`).

Each branch's content lives in a `[`…`]`-bracketed RANGE (the model `when`/`await`/`each`
share) parked before an anchor, so a swap detaches one unit and builds the other. The
guarded branch builds under an ambient `CURRENT_BOUNDARY` so every effect created inside
associates with this boundary (`boundaryFor`); when such an effect throws on a re-run the
scheduler (`flushEffects.drain`) calls `boundary.handle(error)` — which swaps to the catch
branch. No `renderCatch` (no `<template catch>`) means no boundary is installed, so a later
throw propagates to the nearest ENCLOSING `{#try}` unchanged, and an initial throw rethrows.

Keep-the-watch: the terminal alternative would dispose the guarded scope on throw, killing
the only subscription to the failing cell — the boundary would go deaf to recovery. So the
throw carries the originating cell (`AsyncCellError.cell`); on catching an async-cell error
the boundary subscribes to that cell's lifecycle and, when it recovers (error→value via a
`refresh()` or a dep change), rebuilds the guarded content fresh — one rebuild, then
fine-grained. On catch→catch (a fresh error while still failing) the catch branch rebuilds
with the new error (the codegen catch binding is a plain local, so the error passes by
value; in-place `err` update is a v2 refinement).

Hydration claims the SSR boundary (`<!--abide:try:N-->…<!--/abide:try:N-->`): the happy
path adopts the guarded nodes in place and brackets them into a range (so the first swap
detaches them like any later one); a throw discards the server nodes and builds the catch
fresh.
*/
// @documentation plumbing
export function tryBlock(
    parent: Node,
    id: number,
    renderTry: (parent: Node) => void,
    renderCatch?: (parent: Node, error: unknown) => void,
    before: Node | null = null,
): void {
    const hydration = RENDER.hydration
    /* The live branch's scope, registered with the owner so it disposes on owner teardown —
       not only when a swap detaches it. */
    const group = scopeGroup()
    /* Only a block WITH a catch branch installs a boundary: with no catch it cannot handle a
       throw, so its guarded effects must inherit the ENCLOSING boundary (a nested throw then
       propagates outward) and an initial throw rethrows. */
    const hasCatch = renderCatch !== undefined
    let active: { start: Comment; end: Comment; dispose: () => void } | undefined
    let anchor: Node | undefined
    /* The keep-the-watch subscription on the throwing cell, live while the catch branch is
       shown (async-cell errors only); disposed on recover / swap / teardown. */
    let watchDispose: (() => void) | undefined

    const boundary: Boundary = { handle: (error) => showCatch(error) }

    const detach = (): void => {
        if (active !== undefined) {
            active.dispose()
            /* Evict via the end marker's LIVE parent (see `awaitBlock`/`removeRange`). */
            removeRange(active.start, active.end)
            active = undefined
        }
    }

    const disposeWatch = (): void => {
        if (watchDispose !== undefined) {
            watchDispose()
            watchDispose = undefined
        }
    }

    /* Replace the current content with a freshly-built branch, before the anchor. The branch
       builds into a detached `[`…`]`-bracketed fragment, the same primitive the keyed-list
       and await runtimes use. `underBoundary` installs this boundary as the ambient one for
       the build (guarded branch) so its effects associate for later-throw routing; the catch
       branch builds WITHOUT it, so a throw in catch content propagates to the enclosing
       boundary rather than back to this one. */
    const place = (build: (host: Node) => void, underBoundary: boolean): void => {
        /* Backstop: a swap scheduled after the block's anchor was pulled from the tree (an
           enclosing block tore it out) would `insertBefore` a detached node — drop it. */
        if (anchor !== undefined && anchor.parentNode === null) {
            return
        }
        detach()
        const namespaceParent = anchor?.parentNode ?? parent
        const previousBoundary = CURRENT_BOUNDARY.current
        if (underBoundary) {
            CURRENT_BOUNDARY.current = boundary
        }
        let built: ReturnType<typeof buildDetachedRange>
        try {
            built = buildDetachedRange(namespaceParent, build)
        } finally {
            CURRENT_BOUNDARY.current = previousBoundary
        }
        const tracked = group.track(built.dispose)
        namespaceParent.insertBefore(built.fragment, anchor ?? null)
        active = { start: built.start, end: built.end, dispose: tracked }
    }

    /* Build (or rebuild) the guarded branch. A SYNCHRONOUS throw during the build — an
       initial reactive-read throw or a plain build throw — falls to the catch branch (or
       rethrows with no catch, preserving the old boundary's semantics). Later-run throws
       arrive via `boundary.handle` instead. */
    const showTry = (): void => {
        disposeWatch()
        try {
            place((host) => renderTry(host), hasCatch)
        } catch (error) {
            if (!hasCatch) {
                throw error
            }
            showCatch(error)
        }
    }

    /* Swap to the catch branch (rebuilding it with the current error). Keeps a watch on the
       throwing async cell so a recovery re-arms the guarded branch and a fresh error while
       still failing rebuilds catch with the new value. */
    const showCatch = (error: unknown): void => {
        disposeWatch()
        place((host) => (renderCatch as NonNullable<typeof renderCatch>)(host, error), false)
        /* Only a reactive async-cell error carries a source to watch; a plain render bug is
           terminal in v1 (no auto-recovery — a bug is not a data state that self-heals). */
        if (error instanceof AsyncCellError) {
            watchCell(error.cell)
        }
    }

    /* Subscribe to the throwing cell's lifecycle. On recovery (its error clears or a value
       arrives — error→value via `refresh()` or a dep change) rebuild the guarded branch
       fresh; on a fresh error while still failing, rebuild catch with the new error. Created
       OUTSIDE this boundary and the owner (it must not route its own reads here and must not
       double-register), tracked in the group so it disposes with the block. */
    const watchCell = (cell: AsyncCellError['cell']): void => {
        const previousBoundary = CURRENT_BOUNDARY.current
        const previousOwner = OWNER.current
        CURRENT_BOUNDARY.current = undefined
        OWNER.current = undefined
        let firstRun = true
        let dispose: () => void
        try {
            dispose = effect(() => {
                const cellError = cell.error()
                const value = cell.peek()
                /* The first run only subscribes — the cell is still in its error state that
                   drove us here, so acting on it would immediately re-arm. */
                if (firstRun) {
                    firstRun = false
                    return
                }
                /* Recovered: rebuild guarded fresh. Still failing with a fresh error: rebuild
                   catch with it. Either path disposes THIS watch first (safe: an effect fully
                   unlinks itself, so its own end-of-run tracking trims nothing). */
                if (cellError === undefined || value !== undefined) {
                    showTry()
                } else {
                    showCatch(new AsyncCellError(cell, cellError))
                }
            })
        } finally {
            CURRENT_BOUNDARY.current = previousBoundary
            OWNER.current = previousOwner
        }
        watchDispose = group.track(dispose)
    }

    if (hydration !== undefined) {
        firstHydrate()
        return
    }
    anchor = document.createTextNode('')
    parent.insertBefore(anchor, before)
    showTry()

    /* The first run when hydrating: claim the boundary's open marker, adopt the guarded
       server nodes in place, then bracket them into a range so the first swap detaches them
       like every later one. A guarded throw (the server rendered catch, or the client build
       throws too) discards the boundary and builds the catch fresh. */
    function firstHydrate(): void {
        const cursor = hydration as NonNullable<typeof hydration>
        const open = claimExpected(cursor, parent, `abide:try:${id} open marker`)
        try {
            adopt(open)
        } catch (error) {
            rebuildCold(open, error)
        }
    }

    /* Adopt the guarded branch in place: claim the server's `[` range-open marker, build the
       guarded content (which claims its nodes) under the boundary, then claim the `]`
       range-close and the boundary close, parking an anchor so a later swap detaches this
       range like any other. A build throw disposes the partial scope and rethrows so
       `firstHydrate` rebuilds cold. */
    function adopt(open: Node): void {
        const cursor = hydration as NonNullable<typeof hydration>
        cursor.next.set(parent, open.nextSibling ?? null)
        /* The server emits the `[ … ]` range inside the boundary — claim `[` as the live
           range start, then advance the cursor to the first content node. */
        const start = claimExpected(cursor, parent, `abide:try:${id} range-open marker`) as Comment
        cursor.next.set(parent, start.nextSibling ?? null)
        const previousBoundary = CURRENT_BOUNDARY.current
        if (hasCatch) {
            CURRENT_BOUNDARY.current = boundary
        }
        let dispose: (() => void) | undefined
        try {
            let buildFailed = false
            let buildError: unknown
            dispose = group.track(
                scope(() => {
                    try {
                        renderTry(parent)
                    } catch (error) {
                        buildFailed = true
                        buildError = error
                    }
                }),
            )
            if (buildFailed) {
                throw buildError
            }
            const end = claimExpected(
                cursor,
                parent,
                `abide:try:${id} range-close marker`,
            ) as Comment
            cursor.next.set(parent, end.nextSibling ?? null)
            const close = claimExpected(cursor, parent, `/abide:try:${id} close marker`)
            cursor.next.set(parent, close.nextSibling ?? null)
            anchor = document.createTextNode('')
            parent.insertBefore(anchor, close)
            active = { start, end, dispose }
        } catch (error) {
            dispose?.()
            throw error
        } finally {
            CURRENT_BOUNDARY.current = previousBoundary
        }
    }

    /* Discard the SSR boundary and build the catch branch fresh in its place (hydration off).
       No catch → rethrow (the throw surfaces past the boundary, as the sync version did). */
    function rebuildCold(open: Node, error: unknown): void {
        detach()
        const after = discardBoundary(
            parent,
            open,
            `/abide:try:${id}`,
            hydration as NonNullable<typeof hydration>,
        )
        if (!hasCatch) {
            throw error
        }
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, after)
        withoutHydration(() => showCatch(error))
    }
}
