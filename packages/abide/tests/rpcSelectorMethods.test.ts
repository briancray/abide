import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'

const options = { logRequests: false }

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
