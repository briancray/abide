import { describe, expect, test } from 'bun:test'
import { serializeCacheSnapshot } from '../src/lib/server/runtime/serializeCacheSnapshot.ts'
import { streamCacheResolutions } from '../src/lib/server/runtime/streamCacheResolutions.ts'
import type { CacheEntry } from '../src/lib/shared/types/CacheEntry.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'

/* Minimal store holding entries; subscribe/events are unused by these paths. */
function storeWith(entries: CacheEntry[]): CacheStore {
    const map = new Map(entries.map((entry) => [entry.key, entry]))
    return {
        entries: map,
        events: new EventTarget(),
        subscribe: () => {},
        trackLifecycle: () => {},
        markLifecycle: () => {},
        pendingRefresh: new Set(),
        stats: { hits: 0, misses: 0, coalesced: 0 },
    }
}

function jsonResponse(body: unknown): Response {
    return Response.json(body)
}

function entry(key: string, promise: Promise<Response>, settled: boolean): CacheEntry {
    return {
        key,
        promise,
        request: new Request(`https://test.local/rpc/${key}`, { method: 'GET' }),
        ttl: undefined,
        expiresAt: undefined,
        settled,
    }
}

describe('serializeCacheSnapshot partition', () => {
    test('settled GET entries inline; unsettled ones go to pending', async () => {
        const settled = entry('a', Promise.resolve(jsonResponse({ a: 1 })), true)
        const pendingEntry = entry('b', new Promise<Response>(() => {}), false)
        const store = storeWith([settled, pendingEntry])

        const { inline, pending } = await serializeCacheSnapshot(store)

        expect(inline.map((item) => item.key)).toEqual(['a'])
        expect(inline[0].body).toBe(JSON.stringify({ a: 1 }))
        expect(pending.map((item) => item.key)).toEqual(['b'])
    })

    test('non-GET/DELETE entries are excluded from both buckets', async () => {
        const post: CacheEntry = {
            key: 'p',
            promise: Promise.resolve(jsonResponse({ ok: true })),
            request: new Request('https://test.local/rpc/p', { method: 'POST' }),
            ttl: undefined,
            expiresAt: undefined,
            settled: true,
        }
        const { inline, pending } = await serializeCacheSnapshot(storeWith([post]))

        expect(inline).toHaveLength(0)
        expect(pending).toHaveLength(0)
    })
})

describe('streamCacheResolutions out-of-order drain', () => {
    test('yields snapshots in resolution order, not declaration order', async () => {
        const deferred = (delay: number, body: unknown) =>
            new Promise<Response>((resolve) => setTimeout(() => resolve(jsonResponse(body)), delay))

        const slow = entry('slow', deferred(40, { n: 'slow' }), false)
        const fast = entry('fast', deferred(5, { n: 'fast' }), false)
        const store = storeWith([slow, fast])

        const keys: string[] = []
        for await (const result of streamCacheResolutions(store, [slow, fast])) {
            keys.push(result.key)
        }

        // fast (5ms) resolves before slow (40ms) despite being declared second.
        expect(keys).toEqual(['fast', 'slow'])
    })

    test('yields a miss marker for a non-textual body', async () => {
        const binary = entry('bin', Promise.resolve(new Response(new Uint8Array([1, 2, 3]))), false)
        const text = entry('text', Promise.resolve(jsonResponse({ ok: true })), false)
        const store = storeWith([binary, text])

        const missByKey = new Map<string, boolean>()
        for await (const result of streamCacheResolutions(store, [binary, text])) {
            missByKey.set(result.key, 'miss' in result)
        }

        // Every pending key is reported; the binary one is a miss so the client
        // placeholder re-fetches instead of hanging.
        expect(missByKey.get('text')).toBe(false)
        expect(missByKey.get('bin')).toBe(true)
    })
})
