import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { amend } from '../src/lib/shared/amend.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { sharedCacheStoreSlot } from '../src/lib/shared/sharedCacheStoreSlot.ts'
import { settle } from './support/settle.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
    })
}

/* A distinct shared store so activeCacheStore() !== sharedCacheStore(), exactly as
   the server entry always wires it. Without it sharedCacheStore() degrades to the
   active store, the request-scoped ttl:0 keep never fires, and retained-value reads
   evict on settle. */
const unusedSharedStore = createCacheStore()

describe('amend()', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
        sharedCacheStoreSlot.resolver = () => unusedSharedStore
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        sharedCacheStoreSlot.resolver = undefined
    })

    test('mutates the retained value locally with no refetch', async () => {
        let invokes = 0
        const getList = createRemoteFunction<undefined, string[]>({
            method: 'GET',
            url: '/rpc/list',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/list'),
            invoke: async () => {
                invokes += 1
                return jsonResponse(['a'])
            },
        })
        expect(await getList()).toEqual(['a'])
        expect(invokes).toBe(1)

        amend(getList, undefined, (list) => [...list, 'b'])
        await settle()

        expect(await getList()).toEqual(['a', 'b'])
        /* No network fired — the value was mutated in place. */
        expect(invokes).toBe(1)
    })

    test('two-arg form amends every variant (no args)', async () => {
        const getCount = createRemoteFunction<undefined, { n: number }>({
            method: 'GET',
            url: '/rpc/count',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/count'),
            invoke: async () => jsonResponse({ n: 1 }),
        })
        expect(await getCount()).toEqual({ n: 1 })
        amend(getCount, (current) => ({ n: current.n + 10 }))
        await settle()
        expect(await getCount()).toEqual({ n: 11 })
    })

    /* The ADR-0043 value form: a concrete Return replaces the retained value (folded to an
       updater that ignores current), reactive, still no network. This is what a server-side
       amend(args, value) will broadcast in phase 2. */
    test('value form replaces the retained value with no refetch', async () => {
        let invokes = 0
        const getList = createRemoteFunction<undefined, string[]>({
            method: 'GET',
            url: '/rpc/list',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/list'),
            invoke: async () => {
                invokes += 1
                return jsonResponse(['a'])
            },
        })
        expect(await getList()).toEqual(['a'])
        expect(invokes).toBe(1)

        amend(getList, undefined, ['x', 'y'])
        await settle()

        expect(await getList()).toEqual(['x', 'y'])
        expect(invokes).toBe(1)
    })

    /* Instance sugar, no-input rpc: the args key collapses away so amend takes the value
       directly (getList.amend(value)) — the RemoteFunction type drops the args parameter for
       `undefined extends Args`. */
    test('instance value form on a no-input rpc takes the value directly', async () => {
        const getList = createRemoteFunction<undefined, string[]>({
            method: 'GET',
            url: '/rpc/list2',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/list2'),
            invoke: async () => jsonResponse(['a']),
        })
        expect(await getList()).toEqual(['a'])
        getList.amend(['z'])
        await settle()
        expect(await getList()).toEqual(['z'])
    })
})
