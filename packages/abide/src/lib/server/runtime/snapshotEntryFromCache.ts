import { contentBodyKind } from '../../shared/contentBodyKind.ts'
import { contentTypeOf } from '../../shared/contentTypeOf.ts'
import { hasSeedableRequest } from '../../shared/hasSeedableRequest.ts'
import { isStreamingResponse } from '../../shared/isStreamingResponse.ts'
import type { CacheEntry } from '../../shared/types/CacheEntry.ts'
import type { CacheSnapshotEntry } from '../../shared/types/CacheSnapshotEntry.ts'
import type { CacheStore } from '../../shared/types/CacheStore.ts'
import type { HttpMethod } from '../../shared/types/HttpMethod.ts'

/*
Awaits one cache entry and turns it into a wire-safe snapshot, or undefined
when it can't ship. Shared by the inline snapshot path (settled entries,
resolves immediately) and the streaming drain (pending {#await} entries,
resolves whenever the underlying fetch lands). Any entry carrying a wire request
(any method — an inline POST seeds too, so it hydrates warm rather than re-firing
after render) with a textual Content-Type survives; producers/stream cells (no
request) and binary bodies (don't round-trip through JSON) drop out. Seeding is
not replay: the seeded value is read warm once, never auto-re-fired (that stays
GET-only — see REPLAYABLE_METHODS).

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
    /* The request half of the shared shippability gate: a seedable wire request (any method).
       Producer entries and stream cells (no request) never snapshot — the streaming-drain
       caller hands still-pending entries here, so `settled` is NOT gated (the caller's
       snapshotShippable filter already required it for the entries it picks). */
    if (!hasSeedableRequest(entry) || !entry.request) {
        return undefined
    }
    const method = entry.request.method.toUpperCase() as HttpMethod
    const response = await readSettled(entry.promise as Promise<Response>)
    if (!response) {
        return undefined
    }
    /* A failed load never seeds the client: negative caching (errorTtl) can leave an
       error-status entry in the store at snapshot time, but shipping it would warm-hydrate
       a poisoned entry. Skip it — the client live-fetches on the miss and runs its own
       negative cache. (Before errorTtl, errors evicted at settle and never reached here.) */
    if (!response.ok) {
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
    /* Ship only a body the client's WARM read can consume — `json`/`text` per the single
       `contentBodyKind` classification the live decoder uses. Gating on the same table (not a
       private textual list) keeps warm read ≡ live read (ADR-0011): the private list shipped
       `application/xml`, which `contentBodyKind` buckets as `binary` and the warm read defers
       on, so that snapshot could never be consumed warm — a silent divergence. */
    const kind = contentBodyKind(contentTypeOf(response.headers))
    if (kind !== 'json' && kind !== 'text') {
        return undefined
    }
    /* Read a CLONE, not the original: a reader that captured this same `entry.promise`
       before the replacement below still holds `response` and may `.clone()` it — reading
       the original here would lock its body and throw "Body already used" for that reader.
       The body stream can still error mid-read (reset/truncated upstream) after headers
       resolved — degrade that to undefined (matching the fetch-rejection path) so one flaky
       entry doesn't reject the whole snapshot batch and 500 / abort the page stream. */
    let body: string
    try {
        body = await response.clone().text()
    } catch {
        return undefined
    }
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
    }
}

async function readSettled(promise: Promise<Response>): Promise<Response | undefined> {
    try {
        return await promise
    } catch {
        return undefined
    }
}
