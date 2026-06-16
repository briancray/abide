import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { serializeCacheSnapshot } from '../src/lib/server/runtime/serializeCacheSnapshot.ts'
import { streamCacheResolutions } from '../src/lib/server/runtime/streamCacheResolutions.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheEntryFromSnapshot } from '../src/lib/shared/cacheEntryFromSnapshot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'
import type { StreamedResolution } from '../src/lib/shared/types/StreamedResolution.ts'
import type { StreamingPlaceholder } from '../src/lib/shared/types/StreamingPlaceholder.ts'
import { applyStreamedResolution } from '../src/lib/ui/applyStreamedResolution.ts'
import { installStreamingPlaceholders } from '../src/lib/ui/installStreamingPlaceholders.ts'

const options = { logRequests: false }

/*
The streaming protocol's contract test: the server half's actual output
(serializeCacheSnapshot → streamCacheResolutions) is fed directly into the
browser half (installStreamingPlaceholders → applyStreamedResolution), so the
two adapters of the SSR→client seam are pinned against each other rather than
each against an assumed wire shape. If key derivation, the snapshot fields,
or the miss semantics drift on either side, this breaks before a user sees a
hung {#await} or a silent double-fetch.
*/

/* Releasable gate so pending-entry timing is controlled, never slept on. */
function createGate(): { opened: Promise<void>; release: () => void } {
    let release: () => void = () => {}
    const opened = new Promise<void>((resolve) => {
        release = resolve
    })
    return { opened, release }
}

const fastRemote = defineVerb('GET', '/rpc/round-fast', () => json({ n: 1 }))

let slowGate = createGate()
const slowRemote = defineVerb('GET', '/rpc/round-slow', async () => {
    await slowGate.opened
    return json({ n: 42 })
})

let rejectingGate = createGate()
const rejectingRemote = defineVerb('GET', '/rpc/round-reject', async () => {
    await rejectingGate.opened
    /* A handler throw rejects the entry's promise → non-snapshottable → miss marker. */
    throw new Error('round-trip reject')
})

beforeAll(() => {
    cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
})
afterAll(() => {
    cacheStoreSlot.resolver = undefined
})

/* Runs `body` in a request scope and hands back the request-scoped server store. */
async function inServerScope(body: () => Promise<void> | void): Promise<CacheStore> {
    let captured!: CacheStore
    await runWithRequestScope(new Request('https://test.local/'), options, async (store) => {
        captured = store.cache
        await body()
        return new Response('ok')
    })
    return captured
}

/* The placeholder list createServer ships in `__SSR__.streaming`, built the same way. */
function placeholdersFor(pending: Awaited<ReturnType<typeof serializeCacheSnapshot>>['pending']) {
    return pending.map((entry) => ({
        key: entry.key,
        url: entry.request?.url ?? '',
        method: entry.request?.method ?? 'GET',
    })) satisfies StreamingPlaceholder[]
}

describe('streaming protocol round trip', () => {
    test('both sides derive the same key from the route template', async () => {
        const store = await inServerScope(async () => {
            await cache(fastRemote)()
        })
        const { inline } = await serializeCacheSnapshot(store)
        expect(inline).toHaveLength(1)
        /* The client computes its key from the route template before any fetch —
           the server's serialized key must equal that derivation exactly. */
        expect(inline[0].key).toBe(keyForRemoteCall('GET', '/rpc/round-fast', undefined))
    })

    test('args serialize into the key identically regardless of property order', async () => {
        const store = await inServerScope(async () => {
            await cache(fastRemote)({ b: '2', a: '1' })
        })
        const { inline } = await serializeCacheSnapshot(store)
        expect(inline[0].key).toBe(keyForRemoteCall('GET', '/rpc/round-fast', { a: '1', b: '2' }))
    })

    test('a settled entry round-trips into a warm client entry with the decoded value', async () => {
        const store = await inServerScope(async () => {
            await cache(fastRemote)()
        })
        const { inline, pending } = await serializeCacheSnapshot(store)
        expect(pending).toHaveLength(0)

        const clientEntry = cacheEntryFromSnapshot(inline[0])
        expect(clientEntry.settled).toBe(true)
        expect(clientEntry.value).toEqual({ n: 1 })
        expect(await (await (clientEntry.promise as Promise<Response>)).json()).toEqual({ n: 1 })
    })

    test('a pending {#await} entry streams into its placeholder without re-running the handler', async () => {
        slowGate = createGate()
        const store = await inServerScope(() => {
            /* {#await} shape: kick the read off, never await it in the render. */
            void cache(slowRemote)()
        })
        const { inline, pending } = await serializeCacheSnapshot(store)
        expect(inline).toHaveLength(0)
        expect(pending).toHaveLength(1)

        /* Browser side: placeholders installed before hydration. */
        const clientStore = createCacheStore()
        const deferreds = installStreamingPlaceholders(clientStore, placeholdersFor(pending))
        const placeholderEntry = clientStore.entries.get(pending[0].key)
        expect(placeholderEntry).toBeDefined()
        /* The {#await} would grab this promise now, before any resolution lands. */
        const awaited = placeholderEntry?.promise as Promise<Response>

        const invalidated: string[] = []
        clientStore.events.addEventListener('invalidate', (event) => {
            invalidated.push(...(event as CustomEvent<Set<string>>).detail)
        })

        /* Server side: drain the stream, applying each resolution as it lands. */
        slowGate.release()
        const resolutions: StreamedResolution[] = []
        for await (const resolution of streamCacheResolutions(store, pending)) {
            resolutions.push(resolution)
            applyStreamedResolution(clientStore, deferreds, resolution)
        }

        expect(resolutions).toHaveLength(1)
        expect('miss' in resolutions[0]).toBe(false)
        /* The pre-grabbed promise settles with the streamed body — no re-fetch. */
        expect(await (await awaited).json()).toEqual({ n: 42 })
        /* The placeholder was replaced by a warm settled entry under the same key. */
        const settled = clientStore.entries.get(pending[0].key)
        expect(settled?.settled).toBe(true)
        expect(settled?.value).toEqual({ n: 42 })
        /* Reads mounted before arrival were told to re-run. */
        expect(invalidated).toEqual([pending[0].key])
        /* Fully drained: nothing left for the EOF flush. */
        expect(deferreds.size).toBe(0)
    })

    test('a rejected read streams a miss marker and the placeholder re-fetches live', async () => {
        rejectingGate = createGate()
        const store = await inServerScope(() => {
            const read = cache(rejectingRemote)()
            /* The render's {#await} would consume the rejection; keep the test quiet. */
            void (read as Promise<unknown>).catch(() => {})
        })
        const { pending } = await serializeCacheSnapshot(store)
        expect(pending).toHaveLength(1)

        const clientStore = createCacheStore()
        const deferreds = installStreamingPlaceholders(clientStore, placeholdersFor(pending))
        const awaited = clientStore.entries.get(pending[0].key)?.promise as Promise<Response>

        /* The miss fallback re-fetches live; intercept fetch to observe it. */
        const realFetch = globalThis.fetch
        const refetched: string[] = []
        globalThis.fetch = (async (input: Request | string | URL) => {
            const url = input instanceof Request ? input.url : String(input)
            refetched.push(new URL(url).pathname)
            return new Response('{"n":7}', { headers: { 'content-type': 'application/json' } })
        }) as typeof fetch

        try {
            rejectingGate.release()
            for await (const resolution of streamCacheResolutions(store, pending)) {
                expect(resolution).toEqual({ key: pending[0].key, miss: true })
                applyStreamedResolution(clientStore, deferreds, resolution)
            }
            expect(refetched).toEqual(['/rpc/round-reject'])
            expect(await (await awaited).json()).toEqual({ n: 7 })
        } finally {
            globalThis.fetch = realFetch
        }
    })
})
