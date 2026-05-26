/*
Wire format for a single cached response shipped from SSR to client hydration.
Only GET/DELETE entries with a textual Content-Type are emitted — POST/PUT
bodies can't be reconstructed without shipping the original request body,
and binary bodies don't survive a JSON round-trip.
*/
export type CacheSnapshotEntry = {
    key: string
    url: string
    method: 'GET' | 'DELETE'
    status: number
    statusText: string
    headers: Array<[string, string]>
    body: string
}
