import { claimChild } from '../runtime/claimChild.ts'
import { OWNER } from '../runtime/OWNER.ts'
import { RENDER } from '../runtime/RENDER.ts'

/*
Synchronous error boundary — the runtime for `<template try>`. Builds the guarded
subtree (`renderTry`); if building it throws — including a throw from an initial
reactive read, since effects run during build — it tears down the partial scope
and builds `renderCatch(error)` instead. Both branches are a range of element
roots tracked together. No `renderCatch` (no `<template catch>`) re-throws, so the
error propagates to the nearest enclosing boundary (or the server 500 / stream).

Catches throws during the BUILD of the subtree (mount, hydrate adoption, and the
initial reactive reads). A throw in a later effect re-run is outside this lexical
build and is not caught here.

On hydrate it claims the SSR boundary (`<!--abide:try:N-->…<!--/abide:try:N-->`):
the happy path adopts the guarded nodes in place; a throw discards the boundary's
server nodes and builds the catch fresh.
*/
// @readme plumbing
export function tryBlock(
    parent: Node,
    id: number,
    renderTry: (parent: Node) => Node[],
    renderCatch?: (parent: Node, error: unknown) => Node[],
): void {
    /* Run a build under a fresh ownership scope; on throw, tear down the partial
       effects/listeners it registered and rethrow so the caller can fall back. */
    const buildScoped = (build: () => Node[]): Node[] => {
        const previous = OWNER.current
        const disposers: Array<() => void> = []
        OWNER.current = disposers
        try {
            const nodes = build()
            OWNER.current = previous
            return nodes
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
            buildScoped(() => renderTry(parent)) // claims the guarded nodes in place
            const close = claimChild(hydration, parent) // claim the close marker
            hydration.next.set(parent, close?.nextSibling ?? null)
        } catch (error) {
            /* The server rendered (or partially built) something that didn't adopt —
               drop the whole boundary and build the catch fresh in its place. */
            const after = discardBoundary(parent, open, `/abide:try:${id}`, hydration)
            if (renderCatch === undefined) {
                throw error
            }
            const previous = RENDER.hydration
            RENDER.hydration = undefined
            try {
                for (const node of buildScoped(() => renderCatch(parent, error))) {
                    parent.insertBefore(node, after)
                }
            } finally {
                RENDER.hydration = previous
            }
        }
        return
    }

    let nodes: Node[]
    try {
        nodes = buildScoped(() => renderTry(parent))
    } catch (error) {
        if (renderCatch === undefined) {
            throw error
        }
        nodes = buildScoped(() => renderCatch(parent, error))
    }
    for (const node of nodes) {
        parent.appendChild(node)
    }
}

/* Remove the SSR boundary — open marker through close marker (inclusive) — and
   park the hydration cursor on the node after it, returning that node so a fresh
   catch can be inserted in the boundary's place. */
function discardBoundary(
    parent: Node,
    open: Node | null,
    closeData: string,
    hydration: NonNullable<(typeof RENDER)['hydration']>,
): Node | null {
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
    return after
}
