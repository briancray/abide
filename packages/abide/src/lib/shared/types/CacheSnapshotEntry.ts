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
}
