import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { sharedCacheStoreSlot } from '../src/lib/shared/sharedCacheStoreSlot.ts'

const options = { logRequests: false }

/*
End-to-end cache integration: a real defineRpc remote, called through cache()
inside a request scope, against the request-scoped store the server installs.
Mirrors the server entry's resolver (`requestContext.getStore()?.cache`) so
activeCacheStore() resolves the same store cache() sees in production —
exercising dedupe and per-request isolation through the public surface rather
than a fake remote.
*/
/* Distinct shared store, mirroring the server entry (activeCacheStore() !==
   sharedCacheStore()); without it sharedCacheStore() degrades to the request store
   and the request-scoped ttl:0 keep never fires. */
const unusedSharedStore = createCacheStore()

describe('cache() over a real rpc in a request scope', () => {
    let calls = 0
    const getCount = defineRpc('GET', '/rpc/cache-count', () => json({ hit: ++calls }))

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
        sharedCacheStoreSlot.resolver = () => unusedSharedStore
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
        sharedCacheStoreSlot.resolver = undefined
    })

    test('two reads in one request share a single underlying invocation', async () => {
        calls = 0
        const [first, second] = await runWithRequestScope(
            new Request('https://test.local/'),
            options,
            async () => {
                const read = () => cache(getCount)
                const a = await read()
                const b = await read()
                return json([a, b])
            },
        ).then((response) => response.json())

        // Decoded body comes back, and the handler ran exactly once (dedupe).
        expect(first).toEqual({ hit: 1 })
        expect(second).toEqual({ hit: 1 })
        expect(calls).toBe(1)
    })

    test('a second request gets a fresh store, so the handler runs again', async () => {
        calls = 0
        const readOnce = (req: Request) =>
            runWithRequestScope(req, options, async () => json(await cache(getCount))).then(
                (response) => response.json(),
            )

        expect(await readOnce(new Request('https://test.local/'))).toEqual({ hit: 1 })
        // Isolation: the first request's cache doesn't leak into the second.
        expect(await readOnce(new Request('https://test.local/'))).toEqual({ hit: 2 })
        expect(calls).toBe(2)
    })

    test('cache.invalidate(fn) forces the next read to re-run the handler', async () => {
        calls = 0
        const body = await runWithRequestScope(
            new Request('https://test.local/'),
            options,
            async () => {
                const read = () => cache(getCount)
                const before = await read()
                cache.invalidate(getCount)
                const after = await read()
                return json({ before, after })
            },
        ).then((response) => response.json())

        expect(body.before).toEqual({ hit: 1 })
        expect(body.after).toEqual({ hit: 2 })
        expect(calls).toBe(2)
    })

    test('cache(fn.raw) shares the same entry and yields the raw Response', async () => {
        calls = 0
        const status = await runWithRequestScope(
            new Request('https://test.local/'),
            options,
            async () => {
                const decoded = await cache(getCount)
                const response = await cache(getCount.raw)
                expect(decoded).toEqual({ hit: 1 })
                // Raw variant reads the same cached entry — still one invocation.
                expect(calls).toBe(1)
                return json(response.status)
            },
        ).then((response) => response.json())

        expect(status).toBe(200)
    })
})

/*
A mutating rpc still accepts a `cache` policy (the method is a transport choice — a POST that
carries a large body yet is a pure function of its args). An explicit `shared` is a deliberate
"memoise across requests" opt-in that defeats the write's coalesce-only default (drop-on-settle,
the mutation idiom), so the entry lives in the process store with the default Infinity ttl. A
write with NO policy stays coalesce-only, so a fresh request re-runs the handler.
*/
describe('a mutating rpc with cache: { shared } memoises across requests', () => {
    const persistentSharedStore = createCacheStore()
    let sharedCalls = 0
    let plainCalls = 0
    const highlightShared = defineRpc(
        'POST',
        '/rpc/highlight-shared',
        () => json({ n: ++sharedCalls }),
        { cache: { shared: true } },
    )
    const highlightPlain = defineRpc('POST', '/rpc/highlight-plain', () =>
        json({ n: ++plainCalls }),
    )

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
        sharedCacheStoreSlot.resolver = () => persistentSharedStore
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
        sharedCacheStoreSlot.resolver = undefined
    })

    test('shared: true keeps the entry across requests — the handler runs once', async () => {
        sharedCalls = 0
        const readOnce = (req: Request) =>
            runWithRequestScope(req, options, async () => json(await cache(highlightShared))).then(
                (response) => response.json(),
            )

        expect(await readOnce(new Request('https://test.local/a'))).toEqual({ n: 1 })
        // Second, separate request reads the process-store entry warm — no re-run.
        expect(await readOnce(new Request('https://test.local/b'))).toEqual({ n: 1 })
        expect(sharedCalls).toBe(1)
    })

    test('a write with no cache policy stays coalesce-only — re-runs per request', async () => {
        plainCalls = 0
        const readOnce = (req: Request) =>
            runWithRequestScope(req, options, async () => json(await cache(highlightPlain))).then(
                (response) => response.json(),
            )

        expect(await readOnce(new Request('https://test.local/a'))).toEqual({ n: 1 })
        expect(await readOnce(new Request('https://test.local/b'))).toEqual({ n: 2 })
        expect(plainCalls).toBe(2)
    })
})
