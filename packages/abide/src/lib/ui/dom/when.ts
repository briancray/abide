import { ELSE_SEGMENT, THEN_SEGMENT } from '../runtime/BRANCH_SEGMENT.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'
import { mountSwappableRange } from './mountSwappableRange.ts'

/*
Conditional binding — the runtime for `<template if>` (with optional `else`). The
branch's content lives in a RANGE bounded by two comment markers, so a branch may
hold anything — elements, components, text, nested control-flow, snippets — not
just element roots. A 2-case swappable range tracks `condition()` and swaps the
range's content on a truthy↔falsy flip (`render` truthy, `renderElse` falsy); an
unchanged condition is a no-op. See `mountSwappableRange` for the shared
hydrate/swap/teardown semantics.

`isPending` (compiler-supplied only for a bare async subject) adds a third state: while
it returns true the block renders NEITHER branch, so a still-loading promise never flashes
its `{:else}` before settling — "pending" is not conflated with a settled falsy value. It is
consulted first, so `condition()` (the throwing peek) runs only once the cell is no longer
pending; an error then throws to the nearest `{#try}`.
*/
// @documentation plumbing
export function when(
    parent: Node,
    condition: () => unknown,
    render: (parent: Node) => void,
    renderElse?: (parent: Node) => void,
    before: Node | null = null,
    isPending?: () => boolean,
): void {
    mountSwappableRange(
        parent,
        () => {
            if (isPending?.() === true) {
                return 'pending'
            }
            /* A blocking `await` cell embedded in the condition — a member access or compound the
               whole-subject `isPending` gate doesn't cover (`{#if !sources.length}`, `{#if user &&
               await load()}`) — throws a `SuspenseSignal` while pending (ADR-0042). Withhold the
               block (render neither branch) until it settles, exactly as a bare async subject holds;
               the read tracked its cell, so the swap effect re-runs on resolve. */
            try {
                /* The branch key doubles as the branch's render-path segment (see
                   BRANCH_SEGMENT), so it is sourced from the shared alphabet SSR also emits. */
                return condition() ? THEN_SEGMENT : ELSE_SEGMENT
            } catch (signal) {
                if (!(signal instanceof SuspenseSignal)) {
                    throw signal
                }
                return 'pending'
            }
        },
        (branch) =>
            branch === THEN_SEGMENT ? render : branch === ELSE_SEGMENT ? renderElse : undefined,
        before,
        /* An async subject (compiler supplies `isPending`) can render a different branch on the
           server than the pending client, so hydration must not adopt the SSR range in place. */
        isPending !== undefined,
    )
}
