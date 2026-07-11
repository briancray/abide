import type { HttpMethod } from './HttpMethod.ts'

/*
Wire format for a single cached response shipped from SSR to client hydration.
Any entry called inline during render (any method) with a textual Content-Type is
emitted, so the client hydrates warm instead of re-firing the call after render;
binary bodies don't survive a JSON round-trip. The seeded value is read warm once
— it is never auto-replayed (that stays GET-only, see REPLAYABLE_METHODS).
*/
export type CacheSnapshotEntry = {
    key: string
    url: string
    method: HttpMethod
    status: number
    statusText: string
    headers: Array<[string, string]>
    body: string
}
