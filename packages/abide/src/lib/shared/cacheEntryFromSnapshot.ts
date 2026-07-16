import { bodyValueForKind } from './bodyValueForKind.ts'
import { contentBodyKind } from './contentBodyKind.ts'
import { contentTypeOf } from './contentTypeOf.ts'
import { DEFER } from './DEFER.ts'
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
    /* Body text for async readers / shareable clones. A json body arrives PARSED as `data`
       (ADR-0051): re-stringify it (compact JSON — value-identical to the server body, whose
       `json()` also emits compact JSON) so a later `.json()`/`.text()`/`.clone()` still works.
       A text (or parse-failed json) body arrives raw as `body`. */
    const bodyText = 'data' in entry ? JSON.stringify(entry.data) : (entry.body ?? '')
    const response = new Response(bodyText, {
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
        value: warmValueFromSnapshot(entry, headers, bodyText),
        settled: true,
        hydrated: true,
    }
}

/*
Synchronously decodes a snapshot body so the warm entry reads without a
microtask hop on first render. The json/text branches go through the shared
`bodyValueForKind` — the same mapping the live read (`decodeResponse`) uses — so
the two cannot disagree about how a body becomes a value, returning a value
identical to what awaiting the Response would yield. Every non-warmable case —
non-2xx, 204 (the status gate below), streaming, binary (the DEFER sentinel) —
yields no warm value and defers to the async path, which throws HttpError /
returns the streaming error / blobs exactly as a live call would.
*/
function warmValueFromSnapshot(entry: CacheSnapshotEntry, headers: Headers, body: string): unknown {
    /* Status gate is side-specific: an error/204 has no warm value here, but the live
       read throws HttpError / returns undefined for the same status — so it stays out of
       the shared kind mapping. */
    if (entry.status === 204 || entry.status < 200 || entry.status >= 300) {
        return undefined
    }
    const kind = contentBodyKind(contentTypeOf(headers))
    const value = bodyValueForKind(
        kind,
        /* Pre-parsed json body (`data`, ADR-0051) IS the value — no second parse. A raw json
           body may still be malformed; fall back to the async path rather than throwing a
           SyntaxError synchronously during hydration. */
        () => {
            if ('data' in entry) {
                return entry.data
            }
            try {
                return JSON.parse(body)
            } catch {
                return undefined
            }
        },
        () => body,
    )
    /* streaming and binary defer to the async path (the live decode throws / blobs). */
    return value === DEFER ? undefined : value
}
