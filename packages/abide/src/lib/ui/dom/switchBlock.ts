import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'
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
    isPending?: () => boolean,
): void {
    /* Walk the cases in source order (the same order a `{#if}`/`{:elseif}` chain reads): the
       first whose own async condition is still `pending()` HOLDS the chain — returns -1, so no
       later branch renders on a not-yet-known earlier condition; the first whose `match() ===`
       the subject wins; a match-less `default` is the fallback once every case settled without a
       match. A plain `{#switch}` (no per-case `pending`) reduces to first-match-else-default. */
    const select = (value: unknown): number => {
        let fallback = -1
        for (let index = 0; index < cases.length; index++) {
            const entry = cases[index]
            if (entry === undefined) {
                continue
            }
            if (entry.pending?.()) {
                return -1
            }
            if (entry.match === undefined) {
                fallback = index
            } else if (entry.match() === value) {
                return index
            }
        }
        return fallback
    }
    mountSwappableRange(
        parent,
        /* A pending bare async subject (compiler-supplied `isPending`) selects no case — not
           even the default — so the block renders nothing until the cell settles, rather than
           conflating "still loading" with a subject that matched the default. A blocking `await`
           cell embedded in the subject or a `match` (a member access / compound the `isPending`
           gate doesn't cover) throws a `SuspenseSignal` while pending (ADR-0042); select no case
           until it settles, exactly as a bare async subject holds — the read tracked its cell, so
           the swap effect re-runs on resolve. */
        () => {
            if (isPending?.() === true) {
                return -1
            }
            try {
                return select(subject())
            } catch (signal) {
                if (!(signal instanceof SuspenseSignal)) {
                    throw signal
                }
                return -1
            }
        },
        (index) => {
            const chosen = index === -1 ? undefined : cases[index]
            return chosen && ((p) => chosen.render(p))
        },
        before,
        /* Any async subject/branch (a bare async subject, or an async `{:else if}` in a cond-chain)
           can select a different branch on the server than the pending client, so hydration must
           discard the SSR range rather than adopt it in place. */
        isPending !== undefined || cases.some((entry) => entry.pending !== undefined),
    )
}
