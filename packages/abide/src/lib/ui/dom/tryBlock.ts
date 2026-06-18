import { claimChild } from '../runtime/claimChild.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RENDER } from '../runtime/RENDER.ts'
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
// @readme plumbing
export function tryBlock(
    parent: Node,
    id: number,
    renderTry: (parent: Node) => void,
    renderCatch?: (parent: Node, error: unknown) => void,
    before: Node | null = null,
): void {
    /* Run a void build under a fresh ownership scope; on throw, tear down the partial
       effects/listeners it registered and rethrow so the caller can fall back. */
    const guard = (build: () => void): void => {
        const previous = OWNER.current
        const disposers: Array<() => void> = []
        OWNER.current = disposers
        try {
            build()
            OWNER.current = previous
        } catch (error) {
            OWNER.current = previous
            for (let index = disposers.length - 1; index >= 0; index -= 1) {
                disposers[index]?.()
            }
            throw error
        }
    }

    const hydration = RENDER.hydration
    if (hydration !== undefined) {
        const open = claimChild(hydration, parent)
        hydration.next.set(parent, open?.nextSibling ?? null) // advance past the open marker
        try {
            guard(() => renderTry(parent)) // claims the guarded nodes in place
            const close = claimChild(hydration, parent) // claim the close marker
            hydration.next.set(parent, close?.nextSibling ?? null)
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
