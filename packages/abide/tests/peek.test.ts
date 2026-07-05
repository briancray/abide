import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { patch } from '../src/lib/shared/patch.ts'
import { peek } from '../src/lib/shared/peek.ts'
import { settle } from './support/settle.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
    })
}

describe('peek()', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('undefined before any read, the value after a settled read, no invoke', async () => {
        const globals = globalThis as Record<string, unknown>
        const realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
        try {
            let invokes = 0
            const getThing = createRemoteFunction<undefined, { id: string }>({
                method: 'GET',
                url: '/rpc/peekThing',
                clients: BROWSER_ONLY,
                buildRequest: () => new Request('http://x/rpc/peekThing'),
                invoke: async () => {
                    invokes += 1
                    return jsonResponse({ id: '1' })
                },
            })
            /* Nothing retained yet — non-triggering, so still no invoke. */
            expect(peek(getThing)).toBeUndefined()
            expect(invokes).toBe(0)

            expect(await getThing()).toEqual({ id: '1' })
            await settle()
            /* Retained value now readable synchronously; peek fired no extra invoke. */
            expect(peek(getThing)).toEqual({ id: '1' })
            expect(invokes).toBe(1)
        } finally {
            globals.window = realWindow
        }
    })

    test('reflects a patch without a network round-trip', async () => {
        const globals = globalThis as Record<string, unknown>
        const realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
        try {
            const getList = createRemoteFunction<undefined, string[]>({
                method: 'GET',
                url: '/rpc/peekList',
                clients: BROWSER_ONLY,
                buildRequest: () => new Request('http://x/rpc/peekList'),
                invoke: async () => jsonResponse(['a']),
            })
            await getList()
            await settle()
            expect(peek(getList)).toEqual(['a'])

            patch(getList, (list) => [...list, 'b'])
            await settle()
            expect(peek(getList)).toEqual(['a', 'b'])
        } finally {
            globals.window = realWindow
        }
    })
})
