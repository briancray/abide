import { afterEach, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'

/*
The no-double-fetch guarantee: a streaming placeholder (a pending entry with no
warm value) must satisfy cache() reads without invoking the handler, so a
{#await} read awaits the stream instead of racing it with its own fetch. The
streamed resolution then settles the placeholder promise.
*/
describe('streaming placeholder prevents a duplicate fetch', () => {
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('cache() hits the placeholder (handler never runs) until the stream settles it', async () => {
        let calls = 0
        const getValue = defineVerb('GET', '/rpc/placeholder-probe', () => json({ hit: ++calls }))
        const store: CacheStore = createCacheStore()
        cacheStoreSlot.resolver = () => store

        // Mimic installStreamingPlaceholders: a deferred entry, no warm value.
        const key = keyForRemoteCall(getValue.raw.method, getValue.raw.url, undefined)
        let settle!: (response: Response) => void
        const promise = new Promise<Response>((resolve) => {
            settle = resolve
        })
        store.entries.set(key, {
            key,
            promise,
            request: new Request('https://test.local/rpc/placeholder-probe', { method: 'GET' }),
            ttl: undefined,
            expiresAt: undefined,
        })

        // Reading the placeholdered key must not invoke the handler.
        const read = cache(getValue)
        const pending = read()
        expect(calls).toBe(0)

        // Settling the deferred (the streamed resolution) resolves the read.
        settle(Response.json({ hit: 99 }))
        expect(await pending).toEqual({ hit: 99 })
        expect(calls).toBe(0)
    })
})
