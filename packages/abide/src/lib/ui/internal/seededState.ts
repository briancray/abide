// CLIENT STATE SEED REPLAY (Stage 2, PR2) — §5 state-initializer record/replay (decision 10).
//
// The SSR render records each `state(initial)` initial value, in call order, into the hydration seed
// (`server/internal/pages.ts`). This wraps the real client `state` with an ordinal counter so the Nth
// `state()` call on a mount consumes `seed.states[N]` as its initial — the SAME value the server
// rendered with — instead of re-evaluating a (possibly non-deterministic) initializer. The page's
// `transform` is still passed through so later writes transform correctly, and because the recorded
// value is the RAW server initial, `state(seed, transform)` re-applies transform to reach the exact
// value the server cell held.
//
// Falls back to the literal initial when the seed carries no states or the ordinal overflows (current
// fresh-mount behaviour). The counter is created per call, so it resets per mount. `.computed`/`.linked`
// are passed through untouched — they never consumed a seed slot on the server, so they must not
// advance the ordinal here (keeping the count aligned with the server recording).

import type { HydrationSeed } from '../../server/internal/pages.ts'
import type { State, StateCell } from '../state.ts'
import { state } from '../state.ts'

// `isHydrating` reports whether the mount cursor is CLAIMING server nodes right now. `bootstrapPage`
// passes the live runtime flag; it defaults to always-true for direct callers/tests that replay outside
// a real hydrate. Gating on it stops a create-fallback from desyncing the ordinal (see below).
export function makeSeededState(
    seed: HydrationSeed,
    isHydrating: () => boolean = () => true,
): State {
    const seedStates = Array.isArray(seed.states) ? seed.states : undefined
    let ordinal = 0
    return Object.assign(
        function seededState<T>(initial: T, transform?: (value: T) => T): StateCell<T> {
            // Only REPLAY (and advance the ordinal) while actually CLAIMING server nodes. In CREATE mode —
            // a fresh mount, or a hydration mismatch that `claimBlock` recovered by re-mounting a whole
            // region fresh (`inCreateMode`) — there are no server nodes to match, so use the LITERAL
            // initial and DON'T touch the ordinal. Otherwise a create-fallback re-mount (which re-runs the
            // region's `state()` calls) would consume seed slots and desync the ordinal for every sibling
            // region still being claimed — the value the server rendered would land on the wrong `state()`.
            if (!isHydrating()) return state(initial, transform)
            const index = ordinal++
            const value =
                seedStates !== undefined && index < seedStates.length
                    ? (seedStates[index] as T)
                    : initial
            return state(value, transform)
        } as State,
        // `.computed`/`.linked`/`.shared` never consumed a server seed slot (`.shared` is keyed, not
        // ordinal), so they pass through untouched and must NOT advance the ordinal.
        { computed: state.computed, linked: state.linked, shared: state.shared },
    )
}
