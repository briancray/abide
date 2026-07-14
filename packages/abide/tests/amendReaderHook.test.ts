import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createPushIterator } from '../src/lib/shared/createPushIterator.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { sharedCacheStoreSlot } from '../src/lib/shared/sharedCacheStoreSlot.ts'
import type { Socket } from '../src/lib/shared/types/Socket.ts'
import { createAmendReaderHook } from '../src/lib/ui/amendReaderHook.ts'
import { settle } from './support/settle.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

/* A push-driven stand-in for the per-key amend Socket the hook subscribes to. */
function fakeSocket() {
    const iterator = createPushIterator<unknown>(() => undefined)
    const socket = { [Symbol.asyncIterator]: () => iterator } as unknown as Socket<unknown>
    return { socket, push: (value: unknown) => iterator.push(value) }
}

const unusedSharedStore = createCacheStore()

describe('amend reader hook (ADR-0043)', () => {
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

    test('folds a pushed value into the cached read at that key', async () => {
        const getList = createRemoteFunction<undefined, string[]>({
            method: 'GET',
            url: '/rpc/hooklist',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/hooklist'),
            invoke: async () => jsonResponse(['a']),
        })
        expect(await getList()).toEqual(['a'])

        const { socket, push } = fakeSocket()
        const { hook, dispose } = createAmendReaderHook(() => socket)
        /* The cache key for a no-arg GET is its prefix — engage exactly what the store would. */
        hook.engage('GET /rpc/hooklist')
        push(['x', 'y'])
        await settle()

        expect(await getList()).toEqual(['x', 'y'])
        dispose()
    })

    test('refcounts one subscription across co-readers, reopening after the last leaves', () => {
        let opens = 0
        const { socket } = fakeSocket()
        const { hook } = createAmendReaderHook(() => {
            opens += 1
            return socket
        })
        hook.engage('GET /rpc/x')
        hook.engage('GET /rpc/x')
        expect(opens).toBe(1)
        hook.disengage('GET /rpc/x')
        hook.disengage('GET /rpc/x')
        hook.engage('GET /rpc/x')
        expect(opens).toBe(2)
    })

    test('ignores a non-remote (producer) key — nothing to broadcast across clients', () => {
        let opens = 0
        const { socket } = fakeSocket()
        const { hook } = createAmendReaderHook(() => {
            opens += 1
            return socket
        })
        hook.engage('producer#42')
        expect(opens).toBe(0)
    })
})
