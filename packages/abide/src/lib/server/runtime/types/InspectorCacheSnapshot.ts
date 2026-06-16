import type { InspectorCacheEntry } from './InspectorCacheEntry.ts'

/*
The inspector's view of the cache: the process-level (`global: true`) store's
current entries. That's the persistent store — request-scoped caches live and
die with their request, so they surface as per-request tallies in the feed and
traces rather than here.
*/
export type InspectorCacheSnapshot = {
    entries: InspectorCacheEntry[]
}
