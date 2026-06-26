import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'

const options = { logRequests: false }

/*
A cache entry's `settled` flag is the signal SSR streaming keys off: it stays
falsy while the underlying promise is in flight (the {#await} case render()
doesn't block on) and flips true once it resolves (the awaited case that
inlines into the snapshot).
*/
describe('cache entry settled flag', () => {
    const getValue = defineRpc('GET', '/rpc/settled-probe', () => json({ ok: true }))

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('unsettled while in flight, settled after the promise resolves', async () => {
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            const read = cache(getValue)
            const pending = read()
            const store = requestContext.getStore()!.cache
            const entry = Array.from(store.entries.values())[0]

            // In flight: the handler's promise hasn't resolved yet this microtask.
            expect(entry.settled).toBeFalsy()

            await pending
            expect(entry.settled).toBe(true)
            return json(null)
        })
    })
})
