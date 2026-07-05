import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { error as httpError } from '../src/lib/server/error.ts'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'

const options = { logRequests: false }

/* `fn.error(args?)` reads the rpc error registry: most-recent across the rpc (no args), or
   that exact call (args). Typed off Errors at the definition site; here we assert presence. */
describe('fn.error() probe', () => {
    const boom = defineRpc('GET', '/rpc/probe-boom', () => httpError(500, 'boom'))

    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
        /* The rpc error registry is client-only (no server leak); simulate a client. */
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
        delete (globalThis as { window?: unknown }).window
    })

    test('undefined before a call, the error after, cleared by refresh', async () => {
        let before: unknown
        let afterError: unknown
        let afterRefresh: unknown
        await runWithRequestScope(new Request('https://test.local/'), options, async () => {
            before = boom.error()
            await boom().catch(() => undefined)
            afterError = boom.error()
            boom.refresh()
            afterRefresh = boom.error()
            return json(null)
        })
        expect(before).toBeUndefined()
        expect(afterError).toBeInstanceOf(Error)
        expect(afterRefresh).toBeUndefined()
    })
})
