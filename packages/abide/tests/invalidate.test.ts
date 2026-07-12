import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStalenessSlot } from '../src/lib/shared/cacheStalenessSlot.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { invalidate } from '../src/lib/shared/invalidate.ts'
import { refresh } from '../src/lib/shared/refresh.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

describe('invalidate()', () => {
    useBrowserWindow()
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        cacheStalenessSlot.resolver = undefined
    })

    test('drops a non-retained entry so the next read reloads fresh', async () => {
        let n = 0
        async function loadN() {
            n += 1
            return n
        }
        /* An explicit cache() read is non-retained — invalidate DROPS it. */
        expect(await cache(loadN)).toBe(1)
        expect(await cache(loadN)).toBe(1) // warm hit, no reload
        invalidate(loadN)
        await settle()
        expect(await cache(loadN)).toBe(2) // dropped → reloaded
    })

    test('fn.invalidate(args) mirrors invalidate(fn, args)', () => {
        const calls: unknown[][] = []
        /* Redirect the slot so both the instance sugar and the global funnel through one place
           we can observe — proving `fn.invalidate` ≡ `invalidate(fn)`. */
        cacheStalenessSlot.resolver = () => (op, selector, args) => calls.push([op, selector, args])

        const getThing = createRemoteFunction<{ id: number }, { ok: boolean }>({
            method: 'GET',
            url: '/rpc/inv-thing',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/inv-thing'),
            invoke: async () =>
                new Response('{}', { headers: { 'content-type': 'application/json' } }),
        })

        getThing.invalidate({ id: 7 })
        invalidate(getThing, { id: 7 })

        expect(calls).toHaveLength(2)
        expect(calls[0]).toEqual(['invalidate', getThing, { id: 7 }])
        expect(calls[1]).toEqual(['invalidate', getThing, { id: 7 }])
    })

    test('overriding the slot redirects BOTH verbs', () => {
        const ops: string[] = []
        cacheStalenessSlot.resolver = () => (op) => ops.push(op)

        const getThing = createRemoteFunction<undefined, { ok: boolean }>({
            method: 'GET',
            url: '/rpc/inv-both',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/inv-both'),
            invoke: async () =>
                new Response('{}', { headers: { 'content-type': 'application/json' } }),
        })

        invalidate(getThing)
        refresh(getThing)

        expect(ops).toEqual(['invalidate', 'refresh'])
    })
})
