import { effect } from '../effect.ts'
import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import { fillBefore } from './fillBefore.ts'
import { openMarker } from './openMarker.ts'
import { replaceRange } from './replaceRange.ts'

/*
The shared lifecycle of every single-slot control-flow block (`when`, `switchBlock`):
a marker-bounded RANGE that holds at most one piece of content at a time, swapped as a
unit when a `key` changes. The block supplies a `key()` thunk (the identity of the
chosen branch — `'then'|'else'` for `when`, the case index for `switchBlock`) and a
`contentFor(key)` resolver returning that branch's builder, or `undefined` for an
empty branch. This module owns the marker setup, the hydrate-vs-create fork, and the
swap effect with its reentrancy/teardown dance — the structure both blocks copy-pasted.

The chosen branch builds through `scope` (directly on hydrate, via `fillBefore` on a
swap), which builds untracked — so a raw reactive read in the branch content doesn't
subscribe the swap effect; only `key()` (which reads the block's source) drives the
toggle. The branch's own interpolations still track, each through its own effect.

On hydrate it adopts the server-rendered range: claim the start marker, run the chosen
branch in place (its content claims the existing nodes), then claim the end marker. The
effect's first run sees the same key and is a no-op; later changes clear the range and
build fresh into a fragment.

`before` (a static node located by the skeleton) places the range among siblings on
create, so the block sits before a static suffix rather than at the parent's end.
Hydrate ignores it — the claim cursor (positioned past the prefix) drives placement.
*/
export function mountSwappableRange<Key>(
    parent: Node,
    key: () => Key,
    contentFor: (key: Key) => ((parent: Node) => void) | undefined,
    before: Node | null = null,
): void {
    const hydration = RENDER.hydration
    /* The live branch's scope, registered with the owner so it disposes on owner
       teardown — not only on a branch swap via replaceRange. */
    const group = scopeGroup()
    let dispose: (() => void) | undefined
    let activeKey: Key
    let end: Comment

    const start = openMarker(parent, RANGE_OPEN, before)
    if (hydration !== undefined) {
        activeKey = key()
        const chosen = contentFor(activeKey)
        if (chosen !== undefined) {
            dispose = group.track(scope(() => chosen(parent))) // content claims the SSR nodes in place
        }
        end = openMarker(parent, RANGE_CLOSE)
    } else {
        end = openMarker(parent, RANGE_CLOSE, before)
        activeKey = key()
        const chosen = contentFor(activeKey)
        if (chosen !== undefined) {
            dispose = group.track(fillBefore(end, chosen))
        }
    }

    effect(() => {
        const next = key()
        if (next === activeKey) {
            return
        }
        activeKey = next
        const chosen = contentFor(next)
        /* Null `dispose` before `replaceRange` builds the new branch: a reentrant swap
           during that build (an effect in the new content writing the source) would
           otherwise re-enter with the already-disposed disposer and clear it twice. */
        const prior = dispose
        dispose = undefined
        const built = replaceRange(start, end, prior, chosen)
        dispose = built !== undefined ? group.track(built) : undefined
    })
}
