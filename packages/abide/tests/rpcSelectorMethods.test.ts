import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { peek } from '../src/lib/shared/peek.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import { settle } from './support/settle.ts'

const options = { logRequests: false }
const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

/* The rpc instance methods are the globals pre-bound to the rpc selector:
   `fn.X(args?) ≡ X(fn, args?)`, and `fn.cache(args?) ≡ cache(fn)(args)`.

   NOTE: probes must be READ inside runWithRequestScope (they resolve the request-scoped
   cache store), but ASSERTED after it resolves — runWithRequestScope swallows any thrown
   error (assertion failures included) into a 500, so asserting inside the callback is a
   false-green. We capture into `r` and assert outside. */
describe('rpc instance selector methods', () => {
    const getPost = defineRpc('GET', '/rpc/sel-post', () => json({ ok: true }))
    const getUser = defineRpc('GET', '/rpc/sel-user', () => json({ ok: true }))

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('fn.pending() mirrors pending(fn)', async () => {
        const r: Record<string, unknown> = {}
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const promise = cache(getPost)
            r.mirror = getPost.pending() === pending(getPost)
            r.postDuring = getPost.pending()
            r.userPending = getUser.pending()
            await promise
            r.postAfter = getPost.pending()
            return json(null)
        })
        expect(r.mirror).toBe(true)
        expect(r.postDuring).toBe(true)
        expect(r.userPending).toBe(false)
        expect(r.postAfter).toBe(false)
    })

    test('fn.refreshing() mirrors refreshing(fn)', async () => {
        const r: Record<string, unknown> = {}
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const promise = cache(getPost)
            r.mirror = getPost.refreshing() === refreshing(getPost)
            await promise
            return json(null)
        })
        expect(r.mirror).toBe(true)
    })

    test('fn.cache(args?) is a direct read-through call returning the value', async () => {
        const r: Record<string, unknown> = {}
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            r.value = await getPost.cache()
            return json(null)
        })
        expect(r.value).toEqual({ ok: true })
    })

    test('fn.invalidate() drops this rpc entries so the next read re-enters flight', async () => {
        const r: Record<string, unknown> = {}
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            await cache(getPost)
            r.settledBefore = getPost.pending()
            getPost.invalidate()
            const promise = cache(getPost)
            r.pendingAfterInvalidate = getPost.pending()
            await promise
            return json(null)
        })
        expect(r.settledBefore).toBe(false)
        expect(r.pendingAfterInvalidate).toBe(true)
    })
})

/* refresh / patch / peek instance methods mirror their globals. Driven client-side
   (window defined) so a retained read materializes its value for peek(). */
describe('fn.refresh / fn.patch / fn.peek instance methods', () => {
    const globals = globalThis as Record<string, unknown>
    let realWindow: unknown

    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = requestContext.getStore()?.cache
        realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        globals.window = realWindow
    })

    function jsonResponse(value: unknown): Response {
        return new Response(JSON.stringify(value), {
            headers: { 'content-type': 'application/json' },
        })
    }

    test('peek/patch/refresh exist and mirror the global selectors', async () => {
        let invokes = 0
        const getList = createRemoteFunction<undefined, string[]>({
            method: 'GET',
            url: '/rpc/inst-list',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/inst-list'),
            invoke: async () => {
                invokes += 1
                return jsonResponse(['a'])
            },
        })
        expect(typeof getList.peek).toBe('function')
        expect(typeof getList.patch).toBe('function')
        expect(typeof getList.refresh).toBe('function')

        /* peek mirrors the global: undefined before a read, the value after. */
        expect(getList.peek()).toBe(peek(getList))
        expect(getList.peek()).toBeUndefined()
        await getList()
        await settle()
        expect(getList.peek()).toEqual(['a'])
        expect(getList.peek()).toEqual(peek(getList))

        /* patch instance mutates locally, no network. */
        getList.patch((list) => [...list, 'b'])
        await settle()
        expect(getList.peek()).toEqual(['a', 'b'])
        expect(invokes).toBe(1)

        /* refresh instance refetches. */
        getList.refresh()
        await settle()
        expect(invokes).toBe(2)
    })
})
