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
microtask hop on first render. Mirrors decodeResponse for the textual cases the
snapshot ships; non-2xx and 204 yield no warm value and fall back to the async
path, which throws HttpError / returns undefined exactly as a live call would.
Binary/xml bodies also skip the warm path and decode asynchronously.
*/
function warmValueFromSnapshot(status: number, headers: Headers, body: string): unknown {
    if (status === 204 || status < 200 || status >= 300) {
        return undefined
    }
    const contentType = contentTypeOf(headers)
    if (contentType.includes('json')) {
        /*
        `.includes('json')` also matches streaming/non-JSON types like
        application/x-ndjson; fall back to the async path (return undefined)
        rather than throwing a SyntaxError synchronously during hydration.
        */
        try {
            return JSON.parse(body)
        } catch {
            return undefined
        }
    }
    if (contentType.startsWith('text/')) {
        return body
    }
    return undefined
}
