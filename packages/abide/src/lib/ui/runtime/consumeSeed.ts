import { SEED_MARKS } from './SEED_MARKS.ts'

/*
Reads a warm-seed entry (`CELL_SEED` / `DOC_SEED`) under the one-shot contract: a seed
hydrates exactly one pass, so a LATER fresh mount at the same render-path can't
warm-adopt a stale boot-time snapshot (an SPA navigation recomputes the identical key).

Two-phase (ADR-0048): during a hydration pass the read MARKS the entry instead of deleting
it — a clean pass exit deletes the marked keys, and a THROWING pass leaves every value in
place, so the discard→cold-rebuild recovery re-adopts the SSR-resolved values instead of
refetching (a cold refetch would leave blocking `await` cells pending and escape as an
uncaught SuspenseSignal at mount). WITHIN a pass the read is idempotent — a repeat read
re-adopts the still-present value, because the repeat is a block-level cold rebuild
reconstructing the same render-path inside the live pass (its first construction marked
the key, then the adopt desynced); the one-shot half is enforced at pass exit, not per
read. Outside a pass — the recovery rebuild itself, a manual client-only mount — the
read deletes immediately, the plain one-shot.
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
    const value = store[key]
    if (value !== undefined) {
        let keys = marks.get(store)
        if (keys === undefined) {
            keys = new Set()
            marks.set(store, keys)
        }
        keys.add(key)
    }
    return value
}
