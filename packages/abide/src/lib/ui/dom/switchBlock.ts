import { effect } from '../effect.ts'
import { RANGE_CLOSE, RANGE_OPEN } from '../runtime/RANGE_MARKER.ts'
import { RENDER } from '../runtime/RENDER.ts'
import { scope } from '../runtime/scope.ts'
import { scopeGroup } from '../runtime/scopeGroup.ts'
import { fillBefore } from './fillBefore.ts'
import { openMarker } from './openMarker.ts'
import { replaceRange } from './replaceRange.ts'
import type { SwitchCase } from './types/SwitchCase.ts'

/*
Multi-branch binding — the runtime for `{#switch}` blocks and for `{#if}` chains that
include `{:elseif}` branches (compiled as a switch over `true` with Boolean-coerced
match thunks so the first truthy branch wins). An effect evaluates the
subject, picks the first case whose `match` equals it (strict `===`), falling back
to the default (`match` undefined); the chosen case's content lives in a RANGE
bounded by two comment markers, so a case holds any content. Staying on the same
case across a subject change leaves it mounted; switching clears the range and
builds the new case fresh.

On hydrate it adopts the case the server rendered: claim the start marker, run the
matching case in place, claim the end marker. The effect's first run picks the same
case and is a no-op; later changes swap the range.
*/
// @documentation plumbing
export function switchBlock(
    parent: Node,
    subject: () => unknown,
    cases: SwitchCase[],
    before: Node | null = null,
): void {
    const hydration = RENDER.hydration
    /* The live case's scope, registered with the owner so it disposes on owner
       teardown — not only when the subject switches cases via replaceRange. */
    const group = scopeGroup()
    let dispose: (() => void) | undefined
    let activeIndex: number
    let end: Comment

    const select = (value: unknown): number => {
        const matched = cases.findIndex(
            (entry) => entry.match !== undefined && entry.match() === value,
        )
        return matched === -1 ? cases.findIndex((entry) => entry.match === undefined) : matched
    }
    const caseAt = (index: number): SwitchCase | undefined =>
        index === -1 ? undefined : cases[index]
    /* The chosen case builds through `scope` (directly on hydrate, via `fillBefore` on a
       swap), which builds untracked — so a raw reactive read in the case content doesn't
       subscribe the swap effect below; only `subject()` (and each case's `match()`) drives
       the swap. The case's own interpolations still track, each through its own effect. */

    /* `before` places the range among static siblings on create (block before a suffix);
       hydrate ignores it and uses the parked claim cursor. */
    const start = openMarker(parent, RANGE_OPEN, before)
    if (hydration !== undefined) {
        activeIndex = select(subject())
        const chosen = caseAt(activeIndex)
        if (chosen !== undefined) {
            dispose = group.track(scope(() => chosen.render(parent))) // claim the SSR nodes in place
        }
        end = openMarker(parent, RANGE_CLOSE)
    } else {
        end = openMarker(parent, RANGE_CLOSE, before)
        activeIndex = select(subject())
        const chosen = caseAt(activeIndex)
        if (chosen !== undefined) {
            dispose = group.track(fillBefore(end, (p) => chosen.render(p)))
        }
    }

    effect(() => {
        const index = select(subject())
        if (index === activeIndex) {
            return
        }
        activeIndex = index
        const chosen = caseAt(index)
        /* Null `dispose` before `replaceRange` builds the new case: a reentrant switch
           during that build (an effect in the new content writing the subject) would
           otherwise re-enter with the already-disposed disposer and clear it twice. */
        const prior = dispose
        dispose = undefined
        const next = replaceRange(start, end, prior, chosen && ((p) => chosen.render(p)))
        dispose = next !== undefined ? group.track(next) : undefined
    })
}
