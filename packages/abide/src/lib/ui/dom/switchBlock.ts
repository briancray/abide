import { mountSwappableRange } from './mountSwappableRange.ts'
import type { SwitchCase } from './types/SwitchCase.ts'

/*
Multi-branch binding — the runtime for `{#switch}` blocks and for `{#if}` chains that
include `{:elseif}` branches (compiled as a switch over `true` with Boolean-coerced
match thunks so the first truthy branch wins). A swappable range evaluates the
subject, picks the first case whose `match` equals it (strict `===`), falling back
to the default (`match` undefined); the chosen case's content lives in a RANGE
bounded by two comment markers, so a case holds any content. Staying on the same
case across a subject change leaves it mounted; switching clears the range and
builds the new case fresh. See `mountSwappableRange` for the shared
hydrate/swap/teardown semantics — the case index is the swap key.
*/
// @documentation plumbing
export function switchBlock(
    parent: Node,
    subject: () => unknown,
    cases: SwitchCase[],
    before: Node | null = null,
): void {
    /* Pick the first case matching the subject (`===`), else the default (`match`
       undefined), else -1 for no match. */
    const select = (value: unknown): number => {
        const matched = cases.findIndex(
            (entry) => entry.match !== undefined && entry.match() === value,
        )
        return matched === -1 ? cases.findIndex((entry) => entry.match === undefined) : matched
    }
    mountSwappableRange(
        parent,
        () => select(subject()),
        (index) => {
            const chosen = index === -1 ? undefined : cases[index]
            return chosen && ((p) => chosen.render(p))
        },
        before,
    )
}
