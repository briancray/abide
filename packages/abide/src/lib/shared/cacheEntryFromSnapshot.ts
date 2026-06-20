import { contentBodyKind } from './contentBodyKind.ts'
import { contentTypeOf } from './contentTypeOf.ts'
import type { CacheEntry } from './types/CacheEntry.ts'
import type { CacheSnapshotEntry } from './types/CacheSnapshotEntry.ts'

/*
Rebuilds a warm cache entry from a wire snapshot: an already-resolved Response
plus the synchronously-decoded warm value, so cache() reads it without a network
round-trip or a microtask hop. Shared by the initial inline snapshot hydration
and the streamed resolution path. `settled` is true — the body shipped fully
resolved either way. `hydrated` marks that the wrap options didn't travel:
the first cache() read adopts its call site's ttl (see CacheEntry).
*/
export function cacheEntryFromSnapshot(entry: CacheSnapshotEntry): CacheEntry {
    const headers = new Headers(entry.headers)
    const response = new Response(entry.body, {
        status: entry.status,
        statusText: entry.statusText,
        headers,
    })
    return {
        key: entry.key,
        promise: Promise.resolve(response),
        request: new Request(entry.url, { method: entry.method }),
        ttl: undefined,
        expiresAt: undefined,
        value: warmValueFromSnapshot(entry.status, headers, entry.body),
        settled: true,
        hydrated: true,
    }
}

/*
Synchronously decodes a snapshot body so the warm entry reads without a
microtask hop on first render. A strict subset of `decodeResponse`: it warms
only the `json`/`text` kinds (the same `contentBodyKind` the live read switches
on, so the two cannot disagree about a body), returning a value identical to
what awaiting the Response would yield. Every other kind — non-2xx, 204,
streaming, binary — yields no warm value and defers to the async path, which
throws HttpError / returns the streaming error / blobs exactly as a live call
would.
*/
function warmValueFromSnapshot(status: number, headers: Headers, body: string): unknown {
    if (status === 204 || status < 200 || status >= 300) {
        return undefined
    }
    const kind = contentBodyKind(contentTypeOf(headers))
    if (kind === 'json') {
        /* The body may still be malformed JSON; fall back to the async path rather than
           throwing a SyntaxError synchronously during hydration. */
        try {
            return JSON.parse(body)
        } catch {
            return undefined
        }
    }
    if (kind === 'text') {
        return body
    }
    /* streaming and binary defer to the async path (the live decode throws / blobs). */
    return undefined
}
