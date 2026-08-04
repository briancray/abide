// THE SITE-PATH WALK — one implementation, shared by the recorder and the replayer.
//
// `SITE_PATH` next door owns the two SEGMENT spellings, on the argument that a wire format between two
// processes must be joined in one place or a drifted separator becomes a silent wrong value. The WALK
// over that grammar — descend on `forSite`/`forItem`, carry the path, hand each level a `state()` bound
// to its bucket — was still written twice: `server/internal/pages.ts` `makeRecordingState` (records
// each initial into the seed) and `ui/internal/seededState.ts` `makeSeededState` (replays them). Same
// recursion, same `Object.assign`, same root; the only thing that genuinely differs is what one
// `state()` call does, which is exactly what `forBucket` is.
//
// Both copies also threaded TWO parameters, `at(sitePath, bucketPath)`, and every call site passed the
// same string for both — a bucket path IS a site path, and the pair was left over from when a
// `{#for}` item kept its enclosing bucket. One parameter here.

import type { State, StateFactory } from '../../shared/state.ts'
import { state } from '../../shared/state.ts'
import { SITE_PATH } from './SITE_PATH.ts'

// What a `<script>` is handed as its `state`. The two descent members are not on `StateFactory`
// because a component author never calls them — the EMITTED code does (`$scope.state.forSite($site)`
// in both emitters), which is why they have to exist at runtime and why this type states them.
export interface SiteStateFactory extends StateFactory {
    forSite(siteId: number): SiteStateFactory
    forItem(index: number): SiteStateFactory
}

// One `state()`-shaped function, bound to the bucket at `path`.
export type BucketState = <T>(initial: T, transform?: (value: T) => T) => State<T>

export function siteStateFactory(forBucket: (path: string) => BucketState): SiteStateFactory {
    function at(path: string): SiteStateFactory {
        // `.shared` is passed straight through: a shared cell is keyed by its own name across every
        // instance, so it belongs to no bucket and never consumes a seed ordinal.
        return Object.assign(forBucket(path), {
            shared: state.shared,
            forSite: (siteId: number): SiteStateFactory => at(SITE_PATH.forSite(path, siteId)),
            forItem: (index: number): SiteStateFactory => at(SITE_PATH.forItem(path, index)),
        }) as SiteStateFactory
    }
    return at(SITE_PATH.root) // the page/root bucket — the page and all its layouts share it
}
