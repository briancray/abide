import { contentTypeOf } from '../../shared/contentTypeOf.ts'
import { hasReplayableRequest } from '../../shared/hasReplayableRequest.ts'
import { isStreamingResponse } from '../../shared/isStreamingResponse.ts'
import type { CacheEntry } from '../../shared/types/CacheEntry.ts'
import type { CacheSnapshotEntry } from '../../shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../../shared/types/CacheStore.ts'
import type { ReplayableMethod } from '../../shared/types/ReplayableMethod.ts'

/*
Awaits one cache entry and turns it into a wire-safe snapshot, or undefined
when it can't ship. Shared by the inline snapshot path (settled entries,
resolves immediately) and the streaming drain (pending {#await} entries,
resolves whenever the underlying fetch lands). Only replayable methods (see
REPLAYABLE_METHODS) with a textual Content-Type survive — writes must not
re-fire from a snapshot, body-carrying methods can't be replayed without the
original request body, and binary bodies don't round-trip through JSON.

Reads the body once and replaces the entry's promise with a string-bodied
Response so later `shareable()` clones operate on a buffered body instead of
teeing the original stream. Returns undefined on a rejected fetch (the client
falls back to a live re-fetch on cache miss) or when the entry was evicted /
replaced between resolution and read (a concurrent invalidate) so the snapshot
never ships a key that no longer matches the live store.
*/
export async function snapshotEntryFromCache(
    store: CacheStore,
    entry: CacheEntry,
): Promise<CacheSnapshotEntry | undefined> {
    /* The request half of the shared shippability gate: a replayable wire request.
       Producer entries (no request) and non-replayable methods never snapshot — the
       streaming-drain caller hands still-pending entries here, so `settled` is NOT gated
       (the caller's snapshotShippable filter already required it for the entries it picks). */
    if (!hasReplayableRequest(entry) || !entry.request) {
        return undefined
    }
    /* `hasReplayableRequest` already verified the uppercased method is replayable; assert it
       for the snapshot's typed `method` field rather than re-running the same Set check. */
    const method = entry.request.method.toUpperCase() as ReplayableMethod
    const response = await readSettled(entry.promise as Promise<Response>)
    if (!response) {
        return undefined
    }
    if (store.entries.get(entry.key) !== entry) {
        return undefined
    }
    /* A streaming body (SSE / JSONL / NDJSON) can't ship: `response.text()` below would
       hang buffering a never-ending stream, and `decodeResponse` refuses it on the client
       anyway — so a snapshot value would diverge from a live read. Skip it (the same guard
       `decodeResponse` applies), letting the client live-fetch and get the proper streaming
       error. */
    if (isStreamingResponse(response)) {
        return undefined
    }
    const contentType = contentTypeOf(response.headers)
    if (!isTextual(contentType)) {
        return undefined
    }
    /* Read a CLONE, not the original: a reader that captured this same `entry.promise`
       before the replacement below still holds `response` and may `.clone()` it — reading
       the original here would lock its body and throw "Body already used" for that reader. */
    const body = await response.clone().text()
    entry.promise = Promise.resolve(
        new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        }),
    )
    return {
        key: entry.key,
        url: entry.request.url,
        method,
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        body,
        /* Deferred by the SSR resume path → seed the shipped body lazily (no hydration decode). */
        lazy: entry.deferred === true ? true : undefined,
    }
}

async function readSettled(promise: Promise<Response>): Promise<Response | undefined> {
    try {
        return await promise
    } catch {
        return undefined
    }
}

function isTextual(contentType: string): boolean {
    if (contentType.startsWith('text/')) {
        return true
    }
    if (contentType.includes('json')) {
        return true
    }
    if (contentType.includes('xml')) {
        return true
    }
    return false
}
