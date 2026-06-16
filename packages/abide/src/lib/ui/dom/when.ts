import { effect } from '../effect.ts'
import { claimChild } from '../runtime/claimChild.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'

/*
Conditional binding — the runtime for `<template if>` (with optional `else`). An
effect tracks `condition()` and mounts the matching branch (`render` truthy,
`renderElse` falsy), anchored for placement; only a truthy↔falsy flip swaps. A
branch is a RANGE of element roots (one or more), tracked as a node array so a
multi-root branch inserts/removes as a unit.

On hydrate it adopts the branch the server rendered: it runs the matching render
in place (its roots claim the existing nodes), then inserts an anchor after them
for future toggles. The effect's first run sees the same branch and is a no-op;
later toggles (after hydration ends) build fresh.
*/
// @readme plumbing
export function when(
    parent: Node,
    condition: () => unknown,
    render: (parent: Node) => Node[],
    renderElse?: (parent: Node) => Node[],
): void {
    const hydration = RENDER.hydration
    let active: { nodes: Node[]; dispose: () => void } | undefined
    let activeBranch: 'then' | 'else' | undefined
    let anchor: Node

    const build = (chosen: (parent: Node) => Node[]): { nodes: Node[]; dispose: () => void } => {
        let nodes: Node[] = []
        const dispose = scope(() => {
            nodes = chosen(parent)
        })
        return { nodes, dispose }
    }

    if (hydration !== undefined) {
        activeBranch = condition() ? 'then' : 'else'
        const chosen = activeBranch === 'then' ? render : renderElse
        if (chosen !== undefined) {
            active = build(chosen) // roots claim the SSR nodes in place
        }
        anchor = document.createTextNode('')
        parent.insertBefore(anchor, claimChild(hydration, parent))
    } else {
        anchor = document.createTextNode('')
        parent.appendChild(anchor)
    }

    effect(() => {
        const branch = condition() ? 'then' : 'else'
        if (branch === activeBranch) {
            return
        }
        if (active !== undefined) {
            active.dispose()
            for (const node of active.nodes) {
                parent.removeChild(node)
            }
            active = undefined
        }
        activeBranch = branch
        const chosen = branch === 'then' ? render : renderElse
        if (chosen === undefined) {
            return
        }
        active = build(chosen)
        for (const node of active.nodes) {
            parent.insertBefore(node, anchor)
        }
    })
}
