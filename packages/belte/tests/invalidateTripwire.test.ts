import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import { settle } from './support/settle.ts'

/* invalidate never invokes the fn — only its method+url identity matters here. */
function remoteSelector(url: string): RawRemoteFunction<undefined> {
    return Object.assign(() => Promise.resolve(new Response()), {
        method: 'GET',
        url,
        [REMOTE_FUNCTION]: true,
    }) as RawRemoteFunction<undefined>
}

/*
A reactive loop spins invalidations of one selector across microtasks,
starving macrotasks — so many same-selector invalidations within a single
task is its signature, and the tripwire turns a silent CPU lockup into a
console warning naming the selector. Repeats spread across macrotasks
(socket frames, user events) reset the count and stay silent.
*/
describe('invalidate loop tripwire', () => {
    let store = createCacheStore()
    let warn: Mock<typeof console.warn>
    beforeEach(() => {
        store = createCacheStore()
        cacheStoreSlot.resolver = () => store
        warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    })
    afterEach(async () => {
        cacheStoreSlot.resolver = undefined
        warn.mockRestore()
        /* Let the reset timer fire so counts never leak into the next test. */
        await settle()
    })

    test('same-selector invalidations within one task warn once, naming the selector', () => {
        const get = remoteSelector('/rpc/tripwire-loop')
        Array.from({ length: 30 }, () => cache.invalidate(get))
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0][0]).toContain('GET /rpc/tripwire-loop')
        expect(warn.mock.calls[0][0]).toContain('reactive loop')
    })

    test('repeats spread across macrotasks never warn', async () => {
        const get = remoteSelector('/rpc/tripwire-spread')
        Array.from({ length: 24 }, () => cache.invalidate(get))
        await settle()
        Array.from({ length: 24 }, () => cache.invalidate(get))
        expect(warn).not.toHaveBeenCalled()
    })

    test('distinct selectors count separately', () => {
        const a = remoteSelector('/rpc/tripwire-a')
        const b = remoteSelector('/rpc/tripwire-b')
        Array.from({ length: 13 }, () => {
            cache.invalidate(a)
            cache.invalidate(b)
        })
        expect(warn).not.toHaveBeenCalled()
    })
})
