import { SEED_MARKS } from './SEED_MARKS.ts'

/*
Reads a warm-seed entry (`CELL_SEED` / `DOC_SEED`) under the one-shot contract: a seed
hydrates exactly one construction, so a LATER fresh mount at the same render-path can't
warm-adopt a stale boot-time snapshot (an SPA navigation recomputes the identical key).

Two-phase (ADR-0048): during a hydration pass the read MARKS the entry instead of deleting
it — a repeat read this pass misses (the one-shot half), a clean pass exit deletes the
marked keys, and a THROWING pass leaves every value in place, so the discard→cold-rebuild
recovery re-adopts the SSR-resolved values instead of refetching (a cold refetch would
leave blocking `await` cells pending and escape as an uncaught SuspenseSignal at mount).
Outside a pass — the recovery rebuild itself, a manual client-only mount — the read
deletes immediately, the plain one-shot.
*/
export function consumeSeed(store: Record<string, string>, key: string): string | undefined {
    const marks = SEED_MARKS.current
    if (marks === undefined) {
        const value = store[key]
        if (value !== undefined) {
            delete store[key]
        }
        return value
    }
    for (const mark of marks) {
        if (mark.store === store && mark.key === key) {
            return undefined // already adopted this pass — the one-shot half of the contract
        }
    }
    const value = store[key]
    if (value !== undefined) {
        marks.push({ store, key })
    }
    return value
}
