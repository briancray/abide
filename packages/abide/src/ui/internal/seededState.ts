// CLIENT STATE SEED REPLAY (Stage 2, PR2) — §5 state-initializer record/replay (decision 10).
//
// PER-COMPONENT-LOCALIZED ordinals. The SSR render records each `state(initial)` initial into
// the hydration seed, GROUPED PER COMPONENT INSTANCE (`seed.states` is `unknown[][]` — one bucket
// per component, in mount order) rather than one flat array. This wraps the real client `state` as a
// FACTORY: the root (page) is bucket 0; each `<Component/>` mount calls `state.forComponent()` to get a
// fresh wrapper bound to the NEXT bucket, with its OWN local ordinal. So a `state()`-sequence divergence
// inside one component (an extra/missing/reordered call vs the server) desyncs only THAT component's
// bucket — it can no longer cascade into sibling components (which read their own buckets). The
// component id is a shared mount-order counter, deterministic across server/client because both walk the
// same component tree in the same order — so no compile-time site ids or loop-key threading are needed.
//
// Within a bucket it is still POSITIONAL (the Nth `state()` call in that component consumes the bucket's
// Nth value) — a component's own script runs identically on both sides, so its local order is stable.
// Falls back to the literal initial when a bucket/ordinal is absent (fresh-mount / create-fallback). The
// counter is created per call to `makeSeededState`, so it resets per page mount.

import type { HydrationSeed } from '../../server/internal/pages.ts'
import { decode } from '../../shared/internal/codec.ts'
import type { State, StateFactory } from '../../shared/state.ts'
import { state } from '../../shared/state.ts'

// `seed.states` is the rich-codec `encode(...)` string of the whole per-component bucket structure (a
// non-RPC hydrated value — see pages.ts). Decode it back to the `unknown[][]` buckets the ordinal
// replay reads. A malformed/absent payload degrades to no seed (every cell falls back to its literal
// initial) rather than failing the mount.
function decodeStates(encoded: HydrationSeed['states']): unknown[][] | undefined {
    if (typeof encoded !== 'string') return undefined
    try {
        const decoded = decode(encoded)
        return Array.isArray(decoded) ? (decoded as unknown[][]) : undefined
    } catch {
        return undefined
    }
}

// `isHydrating` reports whether the mount cursor is CLAIMING server nodes right now. `bootstrapPage`
// passes the live runtime flag; it defaults to always-true for direct callers/tests that replay outside
// a real hydrate. Gating on it stops a create-fallback from desyncing the ordinal (see below).
export function makeSeededState(
    seed: HydrationSeed,
    isHydrating: () => boolean = () => true,
): StateFactory {
    const buckets = decodeStates(seed.states)
    // The shared mount-order component counter — bumped once per component instance (page = 0). Shared by
    // the root and every `.forComponent()` descendant so ids line up with the server's record order.
    let nextComponentId = -1

    function forComponent(): StateFactory {
        nextComponentId++
        const bucket = buckets !== undefined ? buckets[nextComponentId] : undefined
        let ordinal = 0
        const local = function seededState<T>(initial: T, transform?: (value: T) => T): State<T> {
            // Only REPLAY (and advance the local ordinal) while CLAIMING server nodes. In CREATE mode —
            // a fresh mount, or a create-fallback re-mount — there are no server nodes to match, so use
            // the LITERAL initial and DON'T touch the ordinal.
            if (!isHydrating()) return state(initial, transform)
            const index = ordinal++
            const value =
                bucket !== undefined && Array.isArray(bucket) && index < bucket.length
                    ? (bucket[index] as T)
                    : initial
            return state(value, transform)
        } as StateFactory
        // `.shared` never consumed a seed slot; `.forComponent` dispenses the next component's bucket
        // (same shared counter), so a component adapter can localize its child.
        return Object.assign(local, {
            shared: state.shared,
            forComponent,
        }) as StateFactory
    }

    return forComponent() // the page/root = component bucket 0
}
