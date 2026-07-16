import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { serializeCacheSnapshot } from '../src/lib/server/runtime/serializeCacheSnapshot.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { isReplayableMethod } from '../src/lib/shared/isReplayableMethod.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import { sharedCacheStoreSlot } from '../src/lib/shared/sharedCacheStoreSlot.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import { settle } from './support/settle.ts'

const options = { logRequests: false }

/*
Characterizes the entry eviction lifecycle through the public surface — the
edges the other cache suites don't pin:

  - ttl=0 remote entries on the SERVER stay in the request-scoped store after
    settling so the post-render SSR snapshot can still inline them; on the
    CLIENT (window defined) and in the process-level shared store they evict
    the moment they settle.
  - ttl>0 entries evict after expiry; a read inside the window shares the
    entry without re-running the handler.
  - a rejected call evicts its entry, so the next read retries instead of
    caching the failure.
*/

let calls = 0
/* No endpoint policy: exercises the method-default retention (server coalesce-only,
   client forever) — the "omitted ttl" cases below. */
const countedRemote = defineRpc('GET', '/rpc/ttl-counted', () => json({ hit: ++calls }))

/* Explicit endpoint ttl:0 — the coalesce-only idiom, now that a remote carries no
   call-site options (ADR-0020). Evicts on client/hydration settle. */
let coalesceCalls = 0
const coalesceRemote = defineRpc('GET', '/rpc/ttl-coalesce', () => json({ hit: ++coalesceCalls }), {
    cache: { ttl: 0 },
})

/* Endpoint ttl:0 + shared: lands in the process-level store, and still evicts on settle. */
let sharedCoalesceCalls = 0
const sharedCoalesceRemote = defineRpc(
    'GET',
    '/rpc/ttl-shared-coalesce',
    () => json({ hit: ++sharedCoalesceCalls }),
    { cache: { ttl: 0, shared: true } },
)

let writes = 0
const countedWrite = defineRpc('POST', '/rpc/ttl-write', () => json({ write: ++writes }))

let failures = 0
const flakyRemote = defineRpc('GET', '/rpc/ttl-flaky', () => {
    failures += 1
    if (failures === 1) {
        throw new Error('first call fails')
    }
    return json({ hit: failures })
})

let errorStatusCalls = 0
/* A long endpoint ttl proves an error-status Response is not retained despite it. */
const errorStatusRemote = defineRpc(
    'GET',
    '/rpc/ttl-error-status',
    () => {
        errorStatusCalls += 1
        /* A 500 RESPONSE (fetch resolves on it, doesn't reject) on the first call. */
        return json({ hit: errorStatusCalls }, errorStatusCalls === 1 ? { status: 500 } : {})
    },
    { cache: { ttl: 60000, shared: true } },
)

/* Negative cache (errorTtl): a failed load is retained for the window instead of the
   default evict-and-retry. First call errors, later calls succeed — the counter proves
   the retained failure re-serves WITHOUT re-invoking the handler. */
let errorTtlCalls = 0
const errorTtlRemote = defineRpc(
    'GET',
    '/rpc/error-ttl',
    () => {
        errorTtlCalls += 1
        return json({ hit: errorTtlCalls }, errorTtlCalls === 1 ? { status: 500 } : {})
    },
    { cache: { errorTtl: 30 } },
)

/* Function form: retain a 503, but keep the immediate-retry default for a 500 (undefined). */
let errorTtl503Calls = 0
const errorTtl503Remote = defineRpc(
    'GET',
    '/rpc/error-ttl-503',
    () => {
        errorTtl503Calls += 1
        return json({ hit: errorTtl503Calls }, errorTtl503Calls === 1 ? { status: 503 } : {})
    },
    { cache: { errorTtl: (status) => (status === 503 ? 30 : undefined) } },
)
let errorTtl500Calls = 0
const errorTtl500Remote = defineRpc(
    'GET',
    '/rpc/error-ttl-500',
    () => {
        errorTtl500Calls += 1
        return json({ hit: errorTtl500Calls }, errorTtl500Calls === 1 ? { status: 500 } : {})
    },
    { cache: { errorTtl: (status) => (status === 503 ? 30 : undefined) } },
)

/* Retry-After: header wins over the configured window — a 0 collapses the 60s errorTtl
   to an immediate retry, proving the override without a timing-sensitive assertion. */
let retryAfterCalls = 0
const retryAfterRemote = defineRpc(
    'GET',
    '/rpc/error-ttl-retry-after',
    () => {
        retryAfterCalls += 1
        return json(
            { hit: retryAfterCalls },
            retryAfterCalls === 1 ? { status: 503, headers: { 'retry-after': '0' } } : {},
        )
    },
    { cache: { errorTtl: 60000 } },
)

/* A thrown handler rejects the flight (a network-level fault, no Response) — negative-cached
   under the status-0 window. */
let throwErrorTtlCalls = 0
const throwErrorTtlRemote = defineRpc(
    'GET',
    '/rpc/error-ttl-throw',
    () => {
        throwErrorTtlCalls += 1
        if (throwErrorTtlCalls === 1) {
            throw new Error('boom')
        }
        return json({ hit: throwErrorTtlCalls })
    },
    { cache: { errorTtl: (status) => (status === 0 ? 30 : undefined) } },
)

/* ttl/retention now rides the endpoint (ADR-0020), so dedicated remotes declare the
   policy the retention tests below exercise — countedRemote stays coalesce-only. */
let retainedCalls = 0
const retainedRemote = defineRpc('GET', '/rpc/ttl-retained', () => json({ hit: ++retainedCalls }), {
    cache: { ttl: 20, shared: true },
})
const ttlAdoptRemote = defineRpc('GET', '/rpc/ttl-adopt', () => json({ hit: 0 }), {
    cache: { ttl: 20 },
})

beforeAll(() => {
    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
})
afterAll(() => {
    cacheStoreSlot.resolver = undefined
    sharedCacheStoreSlot.resolver = undefined
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
            /* Omitted endpoint ttl → server coalesce-only default (ttl: 0). */
            await cache(countedRemote)
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
                /* coalesceRemote declares endpoint ttl:0, so the client evicts on settle. */
                await cache(coalesceRemote)
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
            /* A write is coalesce-only by default (server ttl: 0), no policy needed. */
            await cache(countedWrite)
            /*
            The request is the server's atomic unit: an identical call later in
            the same render coalesces deterministically, regardless of whether
            the first had already settled — one render, one effect.
            */
            await cache(countedWrite)
            expect(writes).toBe(1)
            expect(store.entries.size).toBe(1)
            /* The kept entry serves the request only — a write never ships to the client. */
            const inline = await serializeCacheSnapshot(store)
            expect(inline).toHaveLength(0)
        })
    })

    test('the process-level shared store evicts on settle (would leak forever)', async () => {
        const sharedStore = createCacheStore()
        sharedCacheStoreSlot.resolver = () => sharedStore
        try {
            await inServerScope(async () => {
                await cache(sharedCoalesceRemote)
            })
            expect(sharedStore.entries.size).toBe(0)
        } finally {
            sharedCacheStoreSlot.resolver = undefined
        }
    })
})

describe('ttl>0 (expire after resolve)', () => {
    test('a read inside the window shares the entry; expiry evicts it', async () => {
        retainedCalls = 0
        const sharedStore = createCacheStore()
        sharedCacheStoreSlot.resolver = () => sharedStore
        try {
            /* retainedRemote declares cache: { ttl: 20, shared: true } on its endpoint, so
               the entry lands in the shared store and outlives the request scope. */
            await inServerScope(async () => {
                await cache(retainedRemote)
            })
            await inServerScope(async () => {
                expect(await cache(retainedRemote)).toEqual({ hit: 1 })
            })
            expect(retainedCalls).toBe(1)

            /* Past expiry the entry is evicted and the next read re-runs the handler. */
            await Bun.sleep(35)
            expect(sharedStore.entries.size).toBe(0)
            await inServerScope(async () => {
                expect(await cache(retainedRemote)).toEqual({ hit: 2 })
            })
        } finally {
            sharedCacheStoreSlot.resolver = undefined
        }
    })
})

describe('rejection', () => {
    test('a rejected call evicts its entry so the next read retries', async () => {
        failures = 0
        await inServerScope(async (store) => {
            await expect(cache(flakyRemote)).rejects.toThrow()
            /* Give the rejection's eviction handler a microtask to run. */
            await Bun.sleep(1)
            expect(store.entries.size).toBe(0)
            /* Same scope, same key: the failure was not cached. */
            expect(await cache(flakyRemote)).toEqual({ hit: 2 })
        })
    })

    test('a ttl>0 call resolving to an error-status Response is not cached for the ttl', async () => {
        errorStatusCalls = 0
        await inServerScope(async (store) => {
            /* fetch resolves a 500 (only a network fault rejects), so decodeResponse throws. */
            await expect(cache(errorStatusRemote)).rejects.toThrow()
            await Bun.sleep(1) // let the settle handler's eviction run
            expect(store.entries.size).toBe(0)
            /* Within the ttl window, the next read retries rather than serving the cached 500. */
            expect(await cache(errorStatusRemote)).toEqual({ hit: 2 })
        })
    })
})

describe('negative cache (errorTtl)', () => {
    test('retains a failed load, re-serving it within the window then retrying after', async () => {
        errorTtlCalls = 0
        await inServerScope(async (store) => {
            await expect(cache(errorTtlRemote)).rejects.toThrow()
            await Bun.sleep(1)
            /* Opted in → retained, not evicted. */
            expect(store.entries.size).toBe(1)
            /* A second read inside the window re-surfaces the failure with NO handler re-call. */
            await expect(cache(errorTtlRemote)).rejects.toThrow()
            expect(errorTtlCalls).toBe(1)
            /* Past the window the entry evicts and the next read retries (now succeeds). */
            await Bun.sleep(40)
            expect(await cache(errorTtlRemote)).toEqual({ hit: 2 })
            expect(errorTtlCalls).toBe(2)
        })
    })

    test('function form retains a matching status', async () => {
        errorTtl503Calls = 0
        await inServerScope(async (store) => {
            await expect(cache(errorTtl503Remote)).rejects.toThrow()
            await Bun.sleep(1)
            expect(store.entries.size).toBe(1)
            await expect(cache(errorTtl503Remote)).rejects.toThrow()
            expect(errorTtl503Calls).toBe(1)
        })
    })

    test('function form returning undefined keeps the evict-and-retry default', async () => {
        errorTtl500Calls = 0
        await inServerScope(async (store) => {
            /* 500 → fn returned undefined → not negative-cached, evicts as before. */
            await expect(cache(errorTtl500Remote)).rejects.toThrow()
            await Bun.sleep(1)
            expect(store.entries.size).toBe(0)
            expect(await cache(errorTtl500Remote)).toEqual({ hit: 2 })
        })
    })

    test('a Retry-After header overrides the configured window', async () => {
        retryAfterCalls = 0
        await inServerScope(async (store) => {
            /* Retry-After: 0 collapses the 60s errorTtl → immediate evict-and-retry. */
            await expect(cache(retryAfterRemote)).rejects.toThrow()
            await Bun.sleep(1)
            expect(store.entries.size).toBe(0)
            expect(await cache(retryAfterRemote)).toEqual({ hit: 2 })
        })
    })

    test('negative-caches a network fault under status 0', async () => {
        throwErrorTtlCalls = 0
        await inServerScope(async (store) => {
            await expect(cache(throwErrorTtlRemote)).rejects.toThrow()
            await Bun.sleep(1)
            expect(store.entries.size).toBe(1)
            await expect(cache(throwErrorTtlRemote)).rejects.toThrow()
            expect(throwErrorTtlCalls).toBe(1)
        })
    })

    test('a retained error is never shipped in the SSR snapshot', async () => {
        errorTtlCalls = 0
        await inServerScope(async (store) => {
            await expect(cache(errorTtlRemote)).rejects.toThrow()
            await Bun.sleep(1)
            /* Retained in the store... */
            expect(store.entries.size).toBe(1)
            /* ...but not shipped: shipping it would warm-hydrate a poisoned client entry. */
            const inline = await serializeCacheSnapshot(store)
            expect(inline).toHaveLength(0)
        })
    })
})

/*
A hydrated snapshot entry ships without its wrap options, so the first read
adopts its call site's ttl. These reads run OUTSIDE a request scope, so the
store falls back to the process store — and an un-shared read there coalesces
only (ttl 0, no request lifetime to bound it), so it behaves exactly like an
explicit ttl: 0: the hydration pass's readers still warm-hit, but the entry is
evicted a macrotask later and the next render fetches live. ttl > 0 is the one
way to retain past the pass: it starts the expiry clock at that read. On the
CLIENT (window defined) an omitted ttl is retained forever (the tab store is the
atomic unit). The first reader's declaration wins.
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

        /* Both same-pass readers warm-hit — eviction is deferred a macrotask. The
           process-store fallback's coalesce-only default (ttl: 0) drives the eviction. */
        expect(await cache(countedRemote)).toEqual({ hit: 0 })
        expect(await cache(countedRemote)).toEqual({ hit: 0 })
        await settle()
        expect(store.entries.has(key)).toBe(false)
    })

    test('server outside a request: an omitted ttl coalesces only (process-store fallback) — same-pass reads warm-hit, then it evicts', async () => {
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        const key = hydrate(store, countedRemote.raw)

        /* First reader declares nothing — the scopeless process-store fallback default (ttl: 0) applies. */
        expect(await cache(countedRemote)).toEqual({ hit: 0 })
        /* A same-pass re-read still warm-hits off the same entry. */
        expect(await cache(countedRemote)).toEqual({ hit: 0 })
        await settle()
        expect(store.entries.has(key)).toBe(false)
    })

    test('client: an omitted ttl still keeps the hydrated entry forever', async () => {
        const globalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
        ;(globalThis as Record<string, unknown>).window = {}
        try {
            const store = createCacheStore()
            cacheStoreSlot.resolver = () => store
            const key = hydrate(store, countedRemote.raw)

            /* First reader declares forever — it consumes the adoption. */
            expect(await cache(countedRemote)).toEqual({ hit: 0 })
            await settle()
            expect(store.entries.has(key)).toBe(true)

            /* A later re-read of the same forever endpoint neither evicts nor re-arms. */
            expect(await cache(countedRemote)).toEqual({ hit: 0 })
            await settle()
            expect(store.entries.has(key)).toBe(true)
        } finally {
            if (globalDescriptor) {
                Object.defineProperty(globalThis, 'window', globalDescriptor)
            } else {
                delete (globalThis as Record<string, unknown>).window
            }
        }
    })

    test('ttl > 0 starts the expiry clock at the first read', async () => {
        const store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        /* ttlAdoptRemote declares cache: { ttl: 20 }; the hydrated entry adopts it. */
        const key = hydrate(store, ttlAdoptRemote.raw)

        expect(await cache(ttlAdoptRemote)).toEqual({ hit: 0 })
        await settle()
        expect(store.entries.has(key)).toBe(true)

        await Bun.sleep(35)
        expect(store.entries.has(key)).toBe(false)
    })
})
