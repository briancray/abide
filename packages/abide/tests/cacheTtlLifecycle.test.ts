import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { serializeCacheSnapshot } from '../src/lib/server/runtime/serializeCacheSnapshot.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { globalCacheStoreSlot } from '../src/lib/shared/globalCacheStoreSlot.ts'
import { isReplayableMethod } from '../src/lib/shared/isReplayableMethod.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import { settle } from './support/settle.ts'

const options = { logRequests: false }

/*
Characterizes the entry eviction lifecycle through the public surface — the
edges the other cache suites don't pin:

  - ttl=0 remote entries on the SERVER stay in the request-scoped store after
    settling so the post-render SSR snapshot can still inline them; on the
    CLIENT (window defined) and in the process-level global store they evict
    the moment they settle.
  - ttl>0 entries evict after expiry; a read inside the window shares the
    entry without re-running the handler.
  - a rejected call evicts its entry, so the next read retries instead of
    caching the failure.
*/

let calls = 0
const countedRemote = defineVerb('GET', '/rpc/ttl-counted', () => json({ hit: ++calls }))

let writes = 0
const countedWrite = defineVerb('POST', '/rpc/ttl-write', () => json({ write: ++writes }))

let failures = 0
const flakyRemote = defineVerb('GET', '/rpc/ttl-flaky', () => {
    failures += 1
    if (failures === 1) {
        throw new Error('first call fails')
    }
    return json({ hit: failures })
})

let errorStatusCalls = 0
const errorStatusRemote = defineVerb('GET', '/rpc/ttl-error-status', () => {
    errorStatusCalls += 1
    /* A 500 RESPONSE (fetch resolves on it, doesn't reject) on the first call. */
    return json({ hit: errorStatusCalls }, errorStatusCalls === 1 ? { status: 500 } : {})
})

beforeAll(() => {
    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
})
afterAll(() => {
    cacheStoreSlot.resolver = undefined
    globalCacheStoreSlot.resolver = undefined
})

async function inServerScope<T>(body: (store: CacheStore) => Promise<T>): Promise<T> {
    let result!: T
    await runWithRequestScope(new Request('https://test.local/'), options, async (store) => {
        result = await body(store.cache)
        return new Response('ok')
    })
    return result
}

describe('ttl=0 (dedupe only)', () => {
    test('server keeps the settled remote entry for the SSR snapshot', async () => {
        await inServerScope(async (store) => {
            await cache(countedRemote, { ttl: 0 })()
            /* Settled, but retained: the snapshot runs after render() returns. */
            expect(store.entries.size).toBe(1)
            const inline = await serializeCacheSnapshot(store)
            expect(inline).toHaveLength(1)
        })
    })

    test('client evicts the settled remote entry (window defined)', async () => {
        const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
        ;(globalThis as Record<string, unknown>).window = {}
        try {
            await inServerScope(async (store) => {
                await cache(countedRemote, { ttl: 0 })()
                /* Settle handler ran in the await above; client path evicts immediately. */
                expect(store.entries.size).toBe(0)
            })
        } finally {
            if (globalDescriptor) {
                Object.defineProperty(globalThis, 'window', globalDescriptor)
            } else {
                delete (globalThis as Record<string, unknown>).window
            }
        }
    })

    test('the server coalesces a write for the whole request, but never snapshots it', async () => {
        writes = 0
        await inServerScope(async (store) => {
            await cache(countedWrite, { ttl: 0 })()
            /*
            The request is the server's atomic unit: an identical call later in
            the same render coalesces deterministically, regardless of whether
            the first had already settled — one render, one effect.
            */
            await cache(countedWrite, { ttl: 0 })()
            expect(writes).toBe(1)
            expect(store.entries.size).toBe(1)
            /* The kept entry serves the request only — a write never ships to the client. */
            const inline = await serializeCacheSnapshot(store)
            expect(inline).toHaveLength(0)
        })
    })

    test('the process-level global store evicts on settle (would leak forever)', async () => {
        const globalStore = createCacheStore()
        globalCacheStoreSlot.resolver = () => globalStore
        try {
            await inServerScope(async () => {
                await cache(countedRemote, { ttl: 0, global: true })()
            })
            expect(globalStore.entries.size).toBe(0)
        } finally {
            globalCacheStoreSlot.resolver = undefined
        }
    })
})

describe('ttl>0 (expire after resolve)', () => {
    test('a read inside the window shares the entry; expiry evicts it', async () => {
        calls = 0
        const globalStore = createCacheStore()
        globalCacheStoreSlot.resolver = () => globalStore
        try {
            /* Global store so the entry outlives the request scope, like a real memo. */
            await inServerScope(async () => {
                await cache(countedRemote, { ttl: 20, global: true })()
            })
            await inServerScope(async () => {
                expect(await cache(countedRemote, { ttl: 20, global: true })()).toEqual({
                    hit: 1,
                })
            })
            expect(calls).toBe(1)

            /* Past expiry the entry is evicted and the next read re-runs the handler. */
            await Bun.sleep(35)
            expect(globalStore.entries.size).toBe(0)
            await inServerScope(async () => {
                expect(await cache(countedRemote, { ttl: 20, global: true })()).toEqual({
                    hit: 2,
                })
            })
        } finally {
            globalCacheStoreSlot.resolver = undefined
        }
    })
})

describe('rejection', () => {
    test('a rejected call evicts its entry so the next read retries', async () => {
        failures = 0
        await inServerScope(async (store) => {
            await expect(cache(flakyRemote)()).rejects.toThrow()
            /* Give the rejection's eviction handler a microtask to run. */
            await Bun.sleep(1)
            expect(store.entries.size).toBe(0)
            /* Same scope, same key: the failure was not cached. */
            expect(await cache(flakyRemote)()).toEqual({ hit: 2 })
        })
    })

    test('a ttl>0 call resolving to an error-status Response is not cached for the ttl', async () => {
        errorStatusCalls = 0
        await inServerScope(async (store) => {
            /* fetch resolves a 500 (only a network fault rejects), so decodeResponse throws. */
            await expect(cache(errorStatusRemote, { ttl: 60000 })()).rejects.toThrow()
            await Bun.sleep(1) // let the settle handler's eviction run
            expect(store.entries.size).toBe(0)
            /* Within the ttl window, the next read retries rather than serving the cached 500. */
            expect(await cache(errorStatusRemote, { ttl: 60000 })()).toEqual({ hit: 2 })
        })
    })
})

/*
A hydrated snapshot entry ships without its wrap options, so the first read
adopts its call site's ttl: omitted keeps the entry (exactly as shipped),
ttl > 0 starts the expiry clock at that read, and ttl: 0 serves the hydration
pass only — evicted a macrotask later, so every reader in the pass still warm-
hits but the next render fetches live. The first reader's declaration wins.
*/
describe('hydrated entries adopt the reading call site ttl', () => {
    function hydrate(store: CacheStore, remote: RawRemoteFunction<undefined>): string {
        /* Snapshots only ever carry replayable methods; narrow so the entry types as one. */
        if (!isReplayableMethod(remote.method)) {
            throw new Error('hydrate() needs a replayable (GET) remote')
        }
        const key = keyForRemoteCall(remote.method, remote.url, undefined)
        store.entries.set(
            key,
            cacheEntryFromSnapshot({
                key,
                url: `https://test.local${remote.url}`,
                method: remote.method,
                status: 200,
                statusText: 'OK',
                headers: [['content-type', 'application/json']],
                body: '{"hit":0}',
            }),
        )
        return key
    }

    test('ttl: 0 serves every reader in the hydration pass, then evicts', async () => {
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        const key = hydrate(store, countedRemote.raw)

        /* Both same-pass readers warm-hit — eviction is deferred a macrotask. */
        expect(await cache(countedRemote, { ttl: 0 })()).toEqual({ hit: 0 })
        expect(await cache(countedRemote, { ttl: 0 })()).toEqual({ hit: 0 })
        await settle()
        expect(store.entries.has(key)).toBe(false)
    })

    test('an omitted ttl keeps the hydrated entry, and a later ttl: 0 read cannot evict it', async () => {
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        const key = hydrate(store, countedRemote.raw)

        /* First reader declares forever — it consumes the adoption. */
        expect(await cache(countedRemote)()).toEqual({ hit: 0 })
        await settle()
        expect(store.entries.has(key)).toBe(true)

        /* The losing later declaration neither evicts nor re-arms. */
        expect(await cache(countedRemote, { ttl: 0 })()).toEqual({ hit: 0 })
        await settle()
        expect(store.entries.has(key)).toBe(true)
    })

    test('ttl > 0 starts the expiry clock at the first read', async () => {
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        const key = hydrate(store, countedRemote.raw)

        expect(await cache(countedRemote, { ttl: 20 })()).toEqual({ hit: 0 })
        await settle()
        expect(store.entries.has(key)).toBe(true)

        await Bun.sleep(35)
        expect(store.entries.has(key)).toBe(false)
    })
})
