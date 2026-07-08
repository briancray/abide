import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { pending } from '../src/lib/shared/pending.ts'

const options = { logRequests: false }

/*
pending() reflects in-flight membership of the active store. It shares
invalidate's selector grammar, so the global form, the per-function form, and
the scoped form each narrow which entries count toward "loading".
*/
describe('pending()', () => {
    const getPost = defineRpc('GET', '/rpc/pending-post', () => json({ ok: true }))
    const getUser = defineRpc('GET', '/rpc/pending-user', () => json({ ok: true }))
    /* Endpoint-declared tags (ADR-0020) — a remote has no call-site tags option. */
    const getFeed = defineRpc('GET', '/rpc/pending-feed', () => json({ ok: true }), {
        cache: { tags: ['feed'] },
    })

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('true while a call is in flight, false once it settles', async () => {
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const promise = cache(getPost)
            expect(pending()).toBe(true)
            expect(pending(getPost)).toBe(true)

            await promise
            expect(pending()).toBe(false)
            expect(pending(getPost)).toBe(false)
            return json(null)
        })
    })

    test('per-function selector ignores other in-flight calls', async () => {
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const post = cache(getPost)
            expect(pending(getUser)).toBe(false)
            expect(pending(getPost)).toBe(true)
            await post
            return json(null)
        })
    })

    test('tags selector tracks only entries carrying the tag', async () => {
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const post = cache(getFeed)
            expect(pending({ tags: ['feed'] })).toBe(true)
            expect(pending({ tags: ['profile'] })).toBe(false)
            await post
            expect(pending({ tags: ['feed'] })).toBe(false)
            return json(null)
        })
    })
})
