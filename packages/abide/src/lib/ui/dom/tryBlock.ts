import { effect } from '../effect.ts'
import { AsyncCellError } from '../runtime/AsyncCellError.ts'
import { CURRENT_BOUNDARY } from '../runtime/CURRENT_BOUNDARY.ts'
import { claimMarker } from '../runtime/claimMarker.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import type { Boundary } from '../runtime/types/Boundary.ts'
import type { State } from '../runtime/types/State.ts'
import { state } from '../state.ts'
import { anchoredBranch } from './anchoredBranch.ts'
import { discardAndRebuild } from './discardAndRebuild.ts'

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
    id: string,
    renderTry: (parent: Node) => void,
    renderCatch?: (parent: Node, error: State<unknown>) => void,
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
    /* The single active branch mounted before an anchor — owns `active`/`detach`/`place`/
       adopt-strand guard (shared with `awaitBlock`); this block keeps its bespoke boundary
       recovery. */
    const branch = anchoredBranch(parent, group)
    /* The keep-the-watch subscription on the throwing cell, live while the catch branch is
       shown (async-cell errors only); disposed on recover / swap / teardown. */
    let watchDispose: (() => void) | undefined
    /* Which branch is mounted, and the reactive error cell the catch branch reads. A
       catch→catch (a fresh error while still failing) WRITES this cell — the `err` binding
       re-runs in place, no rebuild — mirroring how `awaitBlock` updates its then-value cell. */
    let activeKind: 'try' | 'catch' | undefined
    let errorCell: State<unknown> | undefined

    const boundary: Boundary = { handle: (error) => showCatch(error) }

    const disposeWatch = (): void => {
        if (watchDispose !== undefined) {
            watchDispose()
            watchDispose = undefined
        }
    }

    /* Install this boundary as the ambient one around the guarded branch's build (passed as
       `place`'s `wrapBuild`) so its effects associate for later-throw routing; the catch branch
       builds WITHOUT it, so a throw in catch content propagates to the enclosing boundary rather
       than back to this one. */
    const withBoundary = (run: () => void): void => {
        const previousBoundary = CURRENT_BOUNDARY.current
        CURRENT_BOUNDARY.current = boundary
        try {
            run()
        } finally {
            CURRENT_BOUNDARY.current = previousBoundary
        }
    }

    /* Build (or rebuild) the guarded branch. A SYNCHRONOUS throw during the build — an
       initial reactive-read throw or a plain build throw — falls to the catch branch (or
       rethrows with no catch, preserving the old boundary's semantics). Later-run throws
       arrive via `boundary.handle` instead. */
    const showTry = (): void => {
        disposeWatch()
        try {
            branch.place((host) => renderTry(host), hasCatch ? withBoundary : undefined)
            activeKind = 'try'
            errorCell = undefined
        } catch (error) {
            /* A `SuspenseSignal` is "value pending", not an error, and must NEVER render `{:catch}`
               (ADR-0042 D3, mirroring `flushEffects`, which refuses to route it to a boundary) — that
               would flash the author's catch during loading and, since `rewatch` only arms on an
               `AsyncCellError`, stick there forever. Every reading region withholds its own suspend
               locally (post-ADR-0042 the `{#await}`/`{#each await}` subjects included), so this is
               unreachable in a compiled template; rethrow defensively rather than mislabel it. */
            if (error instanceof SuspenseSignal) {
                throw error
            }
            if (!hasCatch) {
                throw error
            }
            showCatch(error)
        }
    }

    /* Swap to the catch branch. A catch→catch (a fresh error while the catch branch is
       already mounted) updates the reactive `err` cell IN PLACE — the binding re-runs, no
       rebuild, focus/scroll inside the catch branch survive. Otherwise (try→catch, or the
       initial throw) it builds the catch branch fresh around a new error cell. Either way it
       keeps a watch on the throwing async cell so a recovery re-arms the guarded branch. */
    const showCatch = (error: unknown): void => {
        if (activeKind === 'catch' && errorCell !== undefined) {
            errorCell.value = error
            rewatch(error)
            return
        }
        const cell = state<unknown>(error)
        errorCell = cell
        branch.place((host) => (renderCatch as NonNullable<typeof renderCatch>)(host, cell))
        activeKind = 'catch'
        rewatch(error)
    }

    /* (Re)subscribe the keep-the-watch to whatever cell threw this time. Only a reactive
       async-cell error carries a source to watch; a plain render bug is terminal in v1 (a bug
       is not a data state that self-heals). */
    const rewatch = (error: unknown): void => {
        disposeWatch()
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
    const anchorNode = document.createTextNode('')
    branch.anchor = anchorNode
    parent.insertBefore(anchorNode, before)
    showTry()

    /* The first run when hydrating: claim the boundary's open marker, adopt the guarded
       server nodes in place, then bracket them into a range so the first swap detaches them
       like every later one. A guarded throw (the server rendered catch, or the client build
       throws too) discards the boundary and builds the catch fresh. */
    function firstHydrate(): void {
        const cursor = hydration as NonNullable<typeof hydration>
        const open = claimMarker(cursor, parent, `abide:try:${id} open marker`)
        try {
            adopt()
        } catch (error) {
            rebuildCold(open, error)
        }
    }

    /* Adopt the guarded branch in place — the cursor already sits past the boundary open
       (claiming it advanced): claim the server's `[` range-open marker, build the guarded
       content (which claims its nodes) under the boundary, then claim the `]` range-close
       and the boundary close, parking an anchor so a later swap detaches this range like
       any other. A build throw disposes the partial scope and rethrows so `firstHydrate`
       rebuilds cold. */
    function adopt(): void {
        const cursor = hydration as NonNullable<typeof hydration>
        /* The server emits the `[ … ]` range inside the boundary — claim `[` as the live
           range start, advancing the cursor to the first content node. */
        const start = claimMarker(cursor, parent, `abide:try:${id} range-open marker`)
        /* Install the boundary around the whole adopt (build + marker claims); the shared
           strand-dispose guard in `adoptStrand` disposes the partial scope and rethrows on any
           failure, and this `finally` restores the boundary before the rethrow reaches
           `firstHydrate`. */
        const previousBoundary = CURRENT_BOUNDARY.current
        if (hasCatch) {
            CURRENT_BOUNDARY.current = boundary
        }
        try {
            branch.adoptStrand(
                (host) => renderTry(host),
                () => {
                    const end = claimMarker(cursor, parent, `abide:try:${id} range-close marker`)
                    const close = claimMarker(cursor, parent, `/abide:try:${id} close marker`)
                    const anchorNode = document.createTextNode('')
                    parent.insertBefore(anchorNode, close)
                    branch.anchor = anchorNode
                    return { start, end }
                },
            )
            activeKind = 'try'
        } finally {
            CURRENT_BOUNDARY.current = previousBoundary
        }
    }

    /* Discard the SSR boundary and build the catch branch fresh in its place (hydration off).
       No catch → rethrow (the throw surfaces past the boundary, as the sync version did). */
    function rebuildCold(open: Node, error: unknown): void {
        branch.detach()
        discardAndRebuild(
            hydration as NonNullable<typeof hydration>,
            parent,
            open,
            `/abide:try:${id}`,
            (after) => {
                if (!hasCatch) {
                    throw error
                }
                const anchorNode = document.createTextNode('')
                branch.anchor = anchorNode
                parent.insertBefore(anchorNode, after)
                showCatch(error)
            },
        )
    }
}
