// CLIENT STATE SEED REPLAY (Stage 2, PR2) — §5 state-initializer record/replay (decision 10).
//
// SITE-KEYED buckets. The SSR render records each `state(initial)` initial into the hydration seed,
// grouped per component instance and keyed by that instance's SITE PATH (`pages.makeRecordingState`).
// A site path is built from two segments, joined by the shared `SITE_PATH` grammar (both ends of the
// record/replay pair call it, so the separators cannot drift):
//   • `/<siteId>` — a `<Component/>` invocation. `siteId` is assigned in `templatePlan` and read by BOTH
//                   emitters, so it names the same invocation on both sides. Opens a NEW bucket.
//   • `#<index>`  — one `{#for}` iteration. Opens a NEW bucket, so a branch-local `<script>` in the loop
//                   body records its cells per ITEM rather than into one shared ordinal sequence. It
//                   used to keep the enclosing bucket, which was safe only while a loop body could hold
//                   no `state()` calls of its own — a `{#for await}` that re-drains to a different
//                   length on the client would otherwise replay one item's cells into another's.
//
// Keying by SITE rather than by mount order is load-bearing. A `{#for await}` region is discarded and
// re-created ASYNCHRONOUSLY on the client, so with a mount-order counter every component after such a
// block was assigned a different id on each side and silently replayed another component's bucket — a
// wrong value with no hydration mismatch to catch it. A site path is computed from the template, so it
// cannot shift with mount timing. When the two sides genuinely disagree (a streamed item whose value
// differs on re-drain), the key simply doesn't match and the cell falls back to its literal initial.
//
// Within a bucket it is still POSITIONAL (the Nth `state()` call consumes the bucket's Nth value) — a
// script runs identically on both sides, so its local order is stable. The ordinal cursor lives with the
// BUCKET, not the factory, so two factories addressing the same bucket continue one sequence. The page +
// its layouts share the root bucket (`""`). Everything resets per page mount, since the cursors are
// created per `makeSeededState`.

import { decode } from '../../shared/internal/codec.ts'
import type { HydrationSeed } from '../../shared/internal/hydrationSeed.ts'
import type { State } from '../../shared/state.ts'
import { state } from '../../shared/state.ts'
import { type SiteStateFactory, siteStateFactory } from './siteStateFactory.ts'

// `seed.states` is the rich-codec `encode(...)` string of the whole site-keyed bucket map (a non-RPC
// hydrated value — see pages.ts). Decode it back to the buckets the ordinal replay reads. A malformed/
// absent payload degrades to no seed (every cell falls back to its literal initial) rather than failing
// the mount.
function decodeStates(encoded: HydrationSeed['states']): Record<string, unknown[]> | undefined {
    if (typeof encoded !== 'string') return undefined
    try {
        const decoded = decode(encoded)
        if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded))
            return undefined
        return decoded as Record<string, unknown[]>
    } catch {
        return undefined
    }
}

// `isHydrating` reports whether the mount cursor is CLAIMING server nodes right now. `bootstrapPage`
// passes the live runtime flag; it defaults to always-true for direct callers/tests that replay outside
// a real hydrate. Gating on it stops a create-fallback from consuming a bucket's ordinals.
export function makeSeededState(
    seed: HydrationSeed,
    isHydrating: () => boolean = () => true,
): SiteStateFactory {
    const buckets = decodeStates(seed.states)
    // Next unconsumed ordinal per BUCKET path (not per factory) — see the header note on `{#for}` items.
    const cursors = new Map<string, number>()

    // The descent is `siteStateFactory`'s (shared with the recorder); this is only what one `state()`
    // call does in the bucket at `path`.
    return siteStateFactory((path) => <T>(initial: T, transform?: (value: T) => T): State<T> => {
        // Only REPLAY (and advance the bucket's cursor) while CLAIMING server nodes. In CREATE
        // mode — a fresh mount, or a create-fallback re-mount — there are no server nodes to
        // match, so use the LITERAL initial and DON'T touch the cursor.
        if (!isHydrating()) return state(initial, transform)
        const bucket = buckets === undefined ? undefined : buckets[path]
        const index = cursors.get(path) ?? 0
        cursors.set(path, index + 1)
        const value =
            bucket !== undefined && Array.isArray(bucket) && index < bucket.length
                ? (bucket[index] as T)
                : initial
        return state(value, transform)
    })
}
