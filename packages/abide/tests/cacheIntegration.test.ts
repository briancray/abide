import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'

const options = { logRequests: false }

/*
End-to-end cache integration: a real defineRpc remote, called through cache()
inside a request scope, against the request-scoped store the server installs.
Mirrors the server entry's resolver (`requestContext.getStore()?.cache`) so
activeCacheStore() resolves the same store cache() sees in production —
exercising dedupe and per-request isolation through the public surface rather
than a fake remote.
*/
describe('cache() over a real verb in a request scope', () => {
    let calls = 0
    const getCount = defineRpc('GET', '/rpc/cache-count', () => json({ hit: ++calls }))

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('two reads in one request share a single underlying invocation', async () => {
        calls = 0
        const [first, second] = await runWithRequestScope(
            new Request('https://test.local/'),
            options,
            async () => {
                const read = cache(getCount)
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
            runWithRequestScope(req, options, async () => json(await cache(getCount)())).then(
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
                const read = cache(getCount)
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
                const decoded = await cache(getCount)()
                const response = await cache(getCount.raw)()
                expect(decoded).toEqual({ hit: 1 })
                // Raw variant reads the same cached entry — still one invocation.
                expect(calls).toBe(1)
                return json(response.status)
            },
        ).then((response) => response.json())

        expect(status).toBe(200)
    })
})
