import { effect } from '../effect.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import { clearBetween } from './clearBetween.ts'
import { fillBefore } from './fillBefore.ts'
import { openMarker } from './openMarker.ts'

/*
Conditional binding — the runtime for `<template if>` (with optional `else`). The
branch's content lives in a RANGE bounded by two comment markers, so a branch may
hold anything — elements, components, text, nested control-flow, snippets — not
just element roots. An effect tracks `condition()` and swaps the range's content
on a truthy↔falsy flip (`render` truthy, `renderElse` falsy); an unchanged
condition is a no-op.

On hydrate it adopts the server-rendered range: claim the start marker, run the
matching render in place (its content claims the existing nodes), then claim the
end marker. The effect's first run sees the same branch and is a no-op; later
toggles clear the range and build fresh into a fragment.
*/
// @documentation plumbing
export function when(
    parent: Node,
    condition: () => unknown,
    render: (parent: Node) => void,
    renderElse?: (parent: Node) => void,
    before: Node | null = null,
): void {
    const hydration = RENDER.hydration
    /* The chosen branch builds through `scope` (directly on hydrate, via `fillBefore`
       on a swap), which builds untracked — so a raw reactive read in the branch content
       doesn't subscribe the swap effect below; only `condition()` drives the toggle. The
       branch's own interpolations still track, each through its own effect. */
    const chosenFor = (branch: 'then' | 'else') => (branch === 'then' ? render : renderElse)
    /* The live branch's scope, registered with the owner so it disposes on owner
       teardown — not only on a branch flip via clearBetween. */
    const group = scopeGroup()
    let dispose: (() => void) | undefined
    let activeBranch: 'then' | 'else'
    let end: Comment

    /* `before` (a static node located by the skeleton) places the range among siblings on
       create, so the block sits before a static suffix rather than at the parent's end.
       Hydrate ignores it — the claim cursor (positioned past the prefix) drives placement. */
    const start = openMarker(parent, '[', before)
    if (hydration !== undefined) {
        activeBranch = condition() ? 'then' : 'else'
        const chosen = chosenFor(activeBranch)
        if (chosen !== undefined) {
            dispose = group.track(scope(() => chosen(parent))) // content claims the SSR nodes in place
        }
        end = openMarker(parent, ']')
    } else {
        end = openMarker(parent, ']', before)
        activeBranch = condition() ? 'then' : 'else'
        const chosen = chosenFor(activeBranch)
        if (chosen !== undefined) {
            dispose = group.track(fillBefore(end, chosen))
        }
    }

    effect(() => {
        const branch = condition() ? 'then' : 'else'
        if (branch === activeBranch) {
            return
        }
        clearBetween(start, end, dispose)
        dispose = undefined
        activeBranch = branch
        const chosen = chosenFor(branch)
        if (chosen !== undefined) {
            dispose = group.track(fillBefore(end, chosen))
        }
    })
}
