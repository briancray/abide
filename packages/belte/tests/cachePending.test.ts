import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'

const options = { logRequests: false }

/*
cache.pending() reflects in-flight membership of the active store. It shares
invalidate's selector grammar, so the global form, the per-function form, and
the scoped form each narrow which entries count toward "loading".
*/
describe('cache.pending', () => {
    const getPost = defineVerb('GET', '/rpc/pending-post', () => json({ ok: true }))
    const getUser = defineVerb('GET', '/rpc/pending-user', () => json({ ok: true }))

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('true while a call is in flight, false once it settles', async () => {
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const promise = cache(getPost)()
            expect(cache.pending()).toBe(true)
            expect(cache.pending(getPost)).toBe(true)

            await promise
            expect(cache.pending()).toBe(false)
            expect(cache.pending(getPost)).toBe(false)
            return json(null)
        })
    })

    test('per-function selector ignores other in-flight calls', async () => {
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const post = cache(getPost)()
            expect(cache.pending(getUser)).toBe(false)
            expect(cache.pending(getPost)).toBe(true)
            await post
            return json(null)
        })
    })

    test('scope selector tracks only entries tagged with the scope', async () => {
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const post = cache(getPost, { scope: 'feed' })()
            expect(cache.pending({ scope: 'feed' })).toBe(true)
            expect(cache.pending({ scope: 'profile' })).toBe(false)
            await post
            expect(cache.pending({ scope: 'feed' })).toBe(false)
            return json(null)
        })
    })
})
