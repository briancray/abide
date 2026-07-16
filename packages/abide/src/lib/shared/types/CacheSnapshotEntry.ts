import type { HttpMethod } from './HttpMethod.ts'

/*
Wire format for a single cached response shipped from SSR to client hydration.
Any entry called inline during render (any method) with a textual Content-Type is
emitted, so the client hydrates warm instead of re-firing the call after render;
binary bodies don't survive a JSON round-trip. The seeded value is read warm once
— it is never auto-replayed (that stays GET-only, see REPLAYABLE_METHODS).

The body travels in ONE of two shapes, never both (ADR-0051): a json-kind body
ships PARSED as `data` — a live JSON value nested directly in the payload — so the
whole snapshot serialises once (the payload's own `JSON.stringify`) instead of the
body being pre-serialised to a string and then re-escaped as a nested string
literal (the double-encoding that ~2.35×'d the wire and forced the client to parse
the body a second time). A text-kind body — or a json body the server couldn't
parse — ships raw as `body`. The client re-derives which from the presence of
`data` (`cacheEntryFromSnapshot`).
*/
export type CacheSnapshotEntry = {
    key: string
    url: string
    method: HttpMethod
    status: number
    statusText: string
    headers: Array<[string, string]>
    /* Raw body text — present for a text-kind body, or a json body that failed to parse
       server-side (shipped raw, decoded async client-side as before). Absent when `data` is. */
    body?: string
    /* Pre-parsed json-kind body, single-encoded. Present iff the body was json and parsed;
       `'data' in entry` is the discriminator (a `null` json body still keys present). */
    data?: unknown
}
