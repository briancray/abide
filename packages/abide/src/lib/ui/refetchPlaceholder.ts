import type { StreamingDeferred } from './types/StreamingDeferred.ts'

/*
The single placeholder-recovery primitive: settles a deferred {#await} read with
a live re-fetch of its request. Used whenever a streamed resolution can't supply
warm data — a `{ key, miss }` marker (non-snapshottable body) or a placeholder
the stream never settled (clean EOF with leftovers, or a cut). Keeping the
re-fetch policy in one place means the apply path and the flush path can't drift.
*/
export function refetchPlaceholder(deferred: StreamingDeferred): void {
    deferred.resolve(fetch(deferred.request))
}
