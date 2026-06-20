import { describe, expect, test } from 'bun:test'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { decodeResponse } from '../src/lib/shared/decodeResponse.ts'
import type { CacheEntry } from '../src/lib/shared/types/CacheEntry.ts'
import type { CacheSnapshotEntry } from '../src/lib/shared/types/CacheSnapshotEntry.ts'

/* A wire snapshot entry with the given content-type and body. */
function snapshotEntry(contentType: string, body: string): CacheSnapshotEntry {
    return {
        key: `GET /rpc/x ${contentType}`,
        url: 'https://test.local/rpc/x',
        method: 'GET',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', contentType]],
        body,
    }
}

/* A settled GET cache entry whose Response carries `contentType` — the server-side shape
   `serializeCacheSnapshot` partitions and `snapshotEntryFromCache` reads. */
function settledRemoteEntry(contentType: string, body: string): CacheEntry {
    return {
        key: `GET /rpc/x ${contentType}`,
        promise: Promise.resolve(
            new Response(body, { status: 200, headers: { 'content-type': contentType } }),
        ),
        request: new Request('https://test.local/rpc/x', { method: 'GET' }),
        ttl: undefined,
        expiresAt: undefined,
        settled: true,
    }
}

/*
Cache-snapshot isomorphism at the streaming boundary. `decodeResponse` (the live read path)
REFUSES a streaming body (SSE / JSONL / NDJSON) with a "use tail()/stream()" error. The
snapshot path must agree: the warm decoder must not return a value a live read rejects, and
the server must not ship a stream (its `response.text()` would hang on a never-ending body).
Both content-type classifiers are hand-mirrored against `decodeResponse`, so this guards the
exact drift the render-side `skeletonContext` work generalized.
*/
describe('cache snapshot ↔ streaming responses', () => {
    test('warm decoder defers streaming bodies to the throwing live path', async () => {
        for (const contentType of [
            'text/event-stream',
            'application/x-ndjson',
            'application/jsonl',
        ]) {
            const entry = cacheEntryFromSnapshot(snapshotEntry(contentType, 'data: hi\n\n'))
            // not warmed — a live read would throw, so a warm read must not return a value
            expect(entry.value).toBeUndefined()
            // the fallback path (reuse the warm Response → decodeResponse) throws like live
            const response = (await entry.promise) as Response
            expect(decodeResponse(response)).rejects.toThrow(/stream/)
        }
    })

    test('warm decoder still warms a normal JSON body (the happy path is intact)', () => {
        const entry = cacheEntryFromSnapshot(snapshotEntry('application/json', '{"ok":true}'))
        expect(entry.value).toEqual({ ok: true })
    })

    test('serializeCacheSnapshot excludes streaming entries (and does not hang buffering them)', async () => {
        const { serializeCacheSnapshot } = await import(
            '../src/lib/server/runtime/serializeCacheSnapshot.ts'
        )
        const store = createCacheStore()
        for (const entry of [
            settledRemoteEntry('text/event-stream', 'data: hi\n\n'),
            settledRemoteEntry('application/x-ndjson', '{"a":1}\n'),
            settledRemoteEntry('application/json', '{"ok":true}'),
        ]) {
            store.entries.set(entry.key, entry) // map key must equal entry.key
        }

        const inline = await serializeCacheSnapshot(store)

        // only the JSON entry survives; the streaming ones are skipped before `response.text()`
        expect(inline.map((entry) => entry.key)).toEqual(['GET /rpc/x application/json'])
    })
})
