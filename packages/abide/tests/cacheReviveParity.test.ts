import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { peek } from '../src/lib/shared/peek.ts'
import type { OutputWirePlan } from '../src/lib/shared/types/OutputWirePlan.ts'
import { settle } from './support/settle.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

/* The wire form a decoded json() response yields — a Set as an array, a Date as an ISO string —
   which reviveWireOutput turns back into Set/Date per the baked plan (ADR-0029). */
function wireResponse(): Response {
    return new Response(
        JSON.stringify({ ids: ['a', 'b'], when: '2020-01-02T03:04:05.000Z', name: 'plain' }),
        { headers: { 'content-type': 'application/json' } },
    )
}

const PLAN: OutputWirePlan = { ids: 'set', when: 'date' }

type Shape = { ids: Set<string>; when: Date; name: string }

/* ADR-0029 read-parity: the bare `fn(args)` call revives the decoded body's structured fields
   (createRemoteFunction.callable). Before this fix the public `cache(fn, args)` and `cache.peek(fn,
   args)` returned the raw honest-JSON form, so `.ids.has(x)` threw and a Date arrived as a string —
   two supposedly-equivalent read APIs disagreeing with `fn(args)` and with the declared Return. */
describe('cache()/peek() revive structured wire fields like fn()', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    function makeRemote() {
        return createRemoteFunction<undefined, Shape>({
            method: 'GET',
            url: '/rpc/reviveThing',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/reviveThing'),
            invoke: async () => wireResponse(),
            outputWirePlan: PLAN,
        })
    }

    function withWindow(run: () => Promise<void>): Promise<void> {
        const globals = globalThis as Record<string, unknown>
        const realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
        return run().finally(() => {
            globals.window = realWindow
        })
    }

    test('the bare fn(args) call revives (baseline)', async () => {
        await withWindow(async () => {
            const getThing = makeRemote()
            const value = (await getThing()) as Shape
            expect(value.ids).toBeInstanceOf(Set)
            expect([...value.ids]).toEqual(['a', 'b'])
            expect(value.when).toBeInstanceOf(Date)
            expect(value.name).toBe('plain')
        })
    })

    test('cache(fn, args) revives a cold read the same way', async () => {
        await withWindow(async () => {
            const getThing = makeRemote()
            const value = (await cache(getThing)) as Shape
            expect(value.ids).toBeInstanceOf(Set)
            expect([...value.ids]).toEqual(['a', 'b'])
            expect(value.when).toBeInstanceOf(Date)
        })
    })

    test('cache(fn, args) revives a warm read too', async () => {
        await withWindow(async () => {
            const getThing = makeRemote()
            await getThing()
            await settle()
            const warm = (await cache(getThing)) as Shape
            expect(warm.ids).toBeInstanceOf(Set)
            expect(warm.when).toBeInstanceOf(Date)
        })
    })

    test('peek(fn, args) revives the retained value', async () => {
        await withWindow(async () => {
            const getThing = makeRemote()
            await getThing()
            await settle()
            const snapshot = peek(getThing) as Shape
            expect(snapshot.ids).toBeInstanceOf(Set)
            expect([...snapshot.ids]).toEqual(['a', 'b'])
            expect(snapshot.when).toBeInstanceOf(Date)
        })
    })
})
