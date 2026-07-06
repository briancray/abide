import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { refresh } from '../src/lib/shared/refresh.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

describe('refresh()', () => {
    /* SWR retain (the mechanism refresh()'s stale-visible swap relies on) is a
       client-only concern since Task 2 — exercise this describe as a browser tab. */
    useBrowserWindow()
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('re-invokes and swaps the value while keeping the stale value visible', async () => {
        let n = 0
        let releaseSecond: () => void = () => {}
        const secondReady = new Promise<void>((resolve) => {
            releaseSecond = resolve
        })
        const getN = createRemoteFunction<undefined, { n: number }>({
            method: 'GET',
            url: '/rpc/refreshN',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/refreshN'),
            invoke: async () => {
                n += 1
                if (n === 2) {
                    await secondReady
                }
                return new Response(JSON.stringify({ n }), {
                    headers: { 'content-type': 'application/json' },
                })
            },
        })
        expect(await getN()).toEqual({ n: 1 })
        expect(refreshing(getN)).toBe(false)

        refresh(getN)
        /* The refetch fired now and is parked; the retained stale value stays visible. */
        expect(refreshing(getN)).toBe(true)
        expect(await getN()).toEqual({ n: 1 })

        releaseSecond()
        await settle()
        expect(refreshing(getN)).toBe(false)
        expect(await getN()).toEqual({ n: 2 })
    })

    test('refresh() with no match is a no-op (nothing to refetch)', async () => {
        let n = 0
        const getN = createRemoteFunction<undefined, { n: number }>({
            method: 'GET',
            url: '/rpc/refreshNoop',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/refreshNoop'),
            invoke: async () => {
                n += 1
                return new Response(JSON.stringify({ n }), {
                    headers: { 'content-type': 'application/json' },
                })
            },
        })
        /* No prior read → no entry to refetch. */
        refresh(getN)
        await settle()
        expect(n).toBe(0)
    })
})
