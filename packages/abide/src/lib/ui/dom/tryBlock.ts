import { claimExpected } from '../runtime/claimExpected.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import { discardBoundary } from './discardBoundary.ts'
import { enterNamespace } from './enterNamespace.ts'

/*
Synchronous error boundary — the runtime for `<template try>`. Builds the guarded
subtree (`renderTry`); if building it throws — including a throw from an initial
reactive read, since effects run during build — it tears down the partial scope and
builds `renderCatch(error)` instead. Each branch builds its content (any content)
into the parent. No `renderCatch` (no `<template catch>`) re-throws, so the error
propagates to the nearest enclosing boundary. The block renders once and never
re-renders, so its content needs no range markers — an enclosing block's range
removes it on teardown.

On create the guarded content is built into a fragment first, so a throw mid-build
discards the partial nodes (they never entered the document) before the catch
builds. On hydrate it claims the SSR boundary
(`<!--abide:try:N-->…<!--/abide:try:N-->`): the happy path adopts the guarded nodes
in place; a throw discards the boundary's server nodes and builds the catch fresh.
*/
// @documentation plumbing
export function tryBlock(
    parent: Node,
    id: number,
    renderTry: (parent: Node) => void,
    renderCatch?: (parent: Node, error: unknown) => void,
    before: Node | null = null,
): void {
    /* The guarded subtree's scope, registered with the owner so it disposes on owner
       teardown. The block renders once, so there is at most one tracked subtree (the
       try branch, or the catch branch if try threw). */
    const group = scopeGroup()
    /* Run a void build under a fresh ownership scope. On success, hand its disposers to
       the group so the subtree tears down with the owner (they were previously dropped —
       the leak). On throw, tear down the partial build now and rethrow so the caller can
       fall back to the catch branch. */
    const guard = (build: () => void): void => {
        const previous = OWNER.current
        const disposers: Array<() => void> = []
        OWNER.current = disposers
        const disposeAll = (): void => {
            for (let index = disposers.length - 1; index >= 0; index -= 1) {
                disposers[index]?.()
            }
        }
        try {
            build()
            OWNER.current = previous
            group.track(disposeAll)
        } catch (error) {
            OWNER.current = previous
            disposeAll()
            throw error
        }
    }

    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        // Guaranteed control-flow markers — claimExpected throws a legible desync (the close
        // is caught below → rebuild the catch fresh) instead of claiming null and over-clearing.
        const open = claimExpected(hydration, parent, `abide:try:${id} open marker`)
        hydration.next.set(parent, open.nextSibling ?? null) // advance past the open marker
        try {
            guard(() => renderTry(parent)) // claims the guarded nodes in place
            const close = claimExpected(hydration, parent, `/abide:try:${id} close marker`)
            hydration.next.set(parent, close.nextSibling ?? null)
        } catch (error) {
            /* The server markup didn't adopt — drop the whole boundary and build the
               catch fresh in its place. */
            const after = discardBoundary(parent, open, `/abide:try:${id}`, hydration)
            if (renderCatch === undefined) {
                throw error
            }
            const previous = RENDER.hydration
            RENDER.hydration = undefined
            try {
                const fragment = document.createDocumentFragment()
                enterNamespace(parent, () => guard(() => renderCatch(fragment, error)))
                parent.insertBefore(fragment, after)
            } finally {
                RENDER.hydration = previous
            }
        }
        return
    }

    /* Create: build into a fragment so a throw mid-build discards the partial nodes
       (they never entered the document) before the catch builds. */
    try {
        const fragment = document.createDocumentFragment()
        enterNamespace(parent, () => guard(() => renderTry(fragment)))
        parent.insertBefore(fragment, before)
    } catch (error) {
        if (renderCatch === undefined) {
            throw error
        }
        const fragment = document.createDocumentFragment()
        enterNamespace(parent, () => guard(() => renderCatch(fragment, error)))
        parent.insertBefore(fragment, before)
    }
}
