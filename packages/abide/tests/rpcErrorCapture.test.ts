import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { error } from '../src/lib/server/error.ts'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import { rpcErrorRegistry } from '../src/lib/shared/rpcErrorRegistry.ts'

const options = { logRequests: false }

/* Error is captured at the rpc call boundary (createRemoteFunction), keyed by call identity,
   cleared on a later success or invalidate — the cache reject/evict path is untouched.
   Registry reads are global, so we capture inside the scope and assert after it resolves. */
describe('rpc error capture', () => {
    let ok = false
    const maybe = defineRpc('GET', '/rpc/err-maybe', () =>
        ok ? json({ ok: true }) : error(500, 'nope'),
    )
    const key = keyForRemoteCall('GET', '/rpc/err-maybe', undefined)

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('records the thrown error, clears on a later success', async () => {
        let afterError: unknown
        let afterSuccess: unknown
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            ok = false
            await maybe().catch(() => undefined)
            afterError = rpcErrorRegistry.read(key)
            ok = true
            await maybe()
            afterSuccess = rpcErrorRegistry.read(key)
            return json(null)
        })
        expect(afterError).toBeInstanceOf(Error)
        expect(afterSuccess).toBeUndefined()
    })

    test('invalidate clears the recorded error for the key', async () => {
        let afterInvalidate: unknown
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            ok = false
            await maybe().catch(() => undefined)
            cache.invalidate(maybe)
            afterInvalidate = rpcErrorRegistry.read(key)
            return json(null)
        })
        expect(afterInvalidate).toBeUndefined()
    })
})
