import type { ReplayableMethod } from './ReplayableMethod.ts'

/*
Wire format for a single cached response shipped from SSR to client hydration.
Only replayable entries (see REPLAYABLE_METHODS) with a textual Content-Type
are emitted — writes must not re-fire from a snapshot, and binary bodies don't
survive a JSON round-trip.
*/
export type CacheSnapshotEntry = {
    key: string
    url: string
    method: ReplayableMethod
    status: number
    statusText: string
    headers: Array<[string, string]>
    body: string
    /* Deferred seed (Tier 2): the client stores the body but does NOT decode it at boot —
       the warm value is materialized lazily on the first read, off the hydration path. Set
       by the server for a deferred `{#await cache()}` whose value ships via a `{defer,key}`
       resume marker instead of inline, so hydration touches neither copy's decode. */
    lazy?: boolean
}
