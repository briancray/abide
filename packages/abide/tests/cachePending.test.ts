import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
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
            const post = cache(getPost)()
            expect(pending(getUser)).toBe(false)
            expect(pending(getPost)).toBe(true)
            await post
            return json(null)
        })
    })

    test('tags selector tracks only entries carrying the tag', async () => {
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const post = cache(getPost, { tags: 'feed' })()
            expect(pending({ tags: 'feed' })).toBe(true)
            expect(pending({ tags: 'profile' })).toBe(false)
            await post
            expect(pending({ tags: 'feed' })).toBe(false)
            return json(null)
        })
    })
})
