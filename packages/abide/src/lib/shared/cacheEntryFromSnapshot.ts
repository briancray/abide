import { bodyValueForKind, DEFER } from './bodyValueForKind.ts'
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
    /* Deferred seed: decode nothing now — hand back a memoized materializer the first read
       invokes, so hydration pays no payload decode. Eager seed: decode up front as before. */
    const warm = entry.lazy
        ? memoizeWarm(() => warmValueFromSnapshot(entry.status, headers, entry.body))
        : undefined
    return {
        key: entry.key,
        promise: Promise.resolve(response),
        request: new Request(entry.url, { method: entry.method }),
        ttl: undefined,
        expiresAt: undefined,
        value: entry.lazy ? undefined : warmValueFromSnapshot(entry.status, headers, entry.body),
        warm,
        settled: true,
        hydrated: true,
    }
}

/* Wraps a warm decode so it runs at most once — the materialized value (including a
   legitimate undefined for a non-warmable status) is cached after the first call. */
function memoizeWarm(decode: () => unknown): () => unknown {
    let materialized = false
    let value: unknown
    return () => {
        if (!materialized) {
            value = decode()
            materialized = true
        }
        return value
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
function warmValueFromSnapshot(status: number, headers: Headers, body: string): unknown {
    /* Status gate is side-specific: an error/204 has no warm value here, but the live
       read throws HttpError / returns undefined for the same status — so it stays out of
       the shared kind mapping. */
    if (status === 204 || status < 200 || status >= 300) {
        return undefined
    }
    const kind = contentBodyKind(contentTypeOf(headers))
    const value = bodyValueForKind(
        kind,
        /* The body may still be malformed JSON; fall back to the async path rather than
           throwing a SyntaxError synchronously during hydration. */
        () => {
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
