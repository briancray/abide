import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import { sharedCacheStoreSlot } from '../src/lib/shared/sharedCacheStoreSlot.ts'
import { settle } from './support/settle.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

/* A JSON Response the smart call's decode path accepts. */
function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
    })
}

/* Type-level coverage (tsgo validates the body, never executed): the smart bare
   call's second arg accepts `shared` alongside the retention/refetch options. */
function assertSharedOptionTypechecks(): void {
    const getThing = createRemoteFunction<undefined, { id: string }>({
        method: 'GET',
        url: '/rpc/getThing',
        clients: BROWSER_ONLY,
        buildRequest: () => new Request('http://x/rpc/getThing'),
        invoke: async () => jsonResponse({ id: '1' }),
    })
    void getThing(undefined, { shared: true, ttl: 20, tags: ['a'] })
}
void assertSharedOptionTypechecks

describe('smart bare rpc call — shared store', () => {
    let sharedStore = createCacheStore()
    beforeEach(() => {
        sharedStore = createCacheStore()
        sharedCacheStoreSlot.resolver = () => sharedStore
        /* Mirror the server entry's resolver so each runWithRequestScope gets its own
           request store — without it every scope shares the process fallback and the
           request-scoped control below would falsely reuse. */
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterEach(() => {
        sharedCacheStoreSlot.resolver = undefined
        cacheStoreSlot.resolver = undefined
    })

    function countingRemote(url: string, onInvoke: () => number) {
        return createRemoteFunction<undefined, { n: number }>({
            method: 'GET',
            url,
            clients: BROWSER_ONLY,
            buildRequest: () => new Request(`http://x${url}`),
            invoke: async () => jsonResponse({ n: onInvoke() }),
        })
    }

    test('shared: true stores in the process-level store and later requests reuse it', async () => {
        let invokes = 0
        const getShared = countingRemote('/rpc/getShared', () => {
            invokes += 1
            return invokes
        })
        let first: unknown
        let second: unknown
        await runWithRequestScope(new Request('http://x/'), { logRequests: false }, async () => {
            first = await getShared(undefined, { shared: true })
            return new Response('ok')
        })
        await runWithRequestScope(new Request('http://x/'), { logRequests: false }, async () => {
            second = await getShared(undefined, { shared: true })
            return new Response('ok')
        })
        expect(first).toEqual({ n: 1 })
        expect(second).toEqual({ n: 1 })
        expect(invokes).toBe(1)
        expect(sharedStore.entries.size).toBe(1)
    })

    test('without shared the default stays request-scoped — a later request re-fetches', async () => {
        let invokes = 0
        const getScoped = countingRemote('/rpc/getScoped', () => {
            invokes += 1
            return invokes
        })
        await runWithRequestScope(new Request('http://x/'), { logRequests: false }, async () => {
            await getScoped()
            return new Response('ok')
        })
        await runWithRequestScope(new Request('http://x/'), { logRequests: false }, async () => {
            await getScoped()
            return new Response('ok')
        })
        expect(invokes).toBe(2)
        expect(sharedStore.entries.size).toBe(0)
    })
})

describe('smart bare rpc call', () => {
    test('two identical GET calls in one scope coalesce to a single invoke', async () => {
        let invokes = 0
        const getThing = createRemoteFunction<{ id: string }, { id: string }>({
            method: 'GET',
            url: '/rpc/getThing',
            clients: { browser: true, mcp: false, cli: false },
            buildRequest: (args) => new Request(`http://x/rpc/getThing?id=${args?.id}`),
            invoke: async () => {
                invokes += 1
                return new Response(JSON.stringify({ id: '1' }), {
                    headers: { 'content-type': 'application/json' },
                })
            },
        })
        /* Capture values INSIDE the scope, assert AFTER it resolves (runWithRequestScope
           swallows thrown assertion errors into a 500 — never assert inside the callback). */
        let first: unknown
        let second: unknown
        await runWithRequestScope(new Request('http://x/'), { logRequests: false }, async () => {
            first = await getThing({ id: '1' })
            second = await getThing({ id: '1' })
            return new Response('ok')
        })
        expect(first).toEqual({ id: '1' })
        expect(second).toEqual({ id: '1' })
        expect(invokes).toBe(1)
    })
})

/* SWR retention (clarification #1/#2): a replayable read retains its value for
   display unconditionally, ttl marks a staleness deadline the next read past it
   revalidates against (access-triggered, not a background timer), and a write is
   coalesce-only (never retained/revalidated). Drive a single persistent store (the
   client tab store) via cacheStoreSlot. */
describe('smart bare rpc call — SWR retention', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('client: a read retains across reads while a write re-fires (coalesce-only)', async () => {
        const globals = globalThis as Record<string, unknown>
        const realWindow = globals.window
        globals.window = { location: { href: 'http://x/' } }
        try {
            let reads = 0
            let writes = 0
            const getThing = createRemoteFunction<undefined, { n: number }>({
                method: 'GET',
                url: '/rpc/read',
                clients: BROWSER_ONLY,
                buildRequest: () => new Request('http://x/rpc/read'),
                invoke: async () => {
                    reads += 1
                    return jsonResponse({ n: reads })
                },
            })
            const doWrite = createRemoteFunction<{ v: number }, { ok: boolean }>({
                method: 'POST',
                url: '/rpc/write',
                clients: BROWSER_ONLY,
                buildRequest: () => new Request('http://x/rpc/write', { method: 'POST' }),
                invoke: async () => {
                    writes += 1
                    return jsonResponse({ ok: true })
                },
            })
            /* Read retained: a second read after the first settled is a warm hit. */
            expect(await getThing()).toEqual({ n: 1 })
            await new Promise((resolve) => setTimeout(resolve, 0))
            expect(await getThing()).toEqual({ n: 1 })
            expect(reads).toBe(1)
            /* Write coalesce-only: evicted on settle, so a second submit re-fires. */
            await doWrite({ v: 1 })
            await new Promise((resolve) => setTimeout(resolve, 0))
            await doWrite({ v: 1 })
            expect(writes).toBe(2)
        } finally {
            globals.window = realWindow
        }
    })

    test('a read past the ttl triggers a background revalidation that keeps the stale value visible', async () => {
        let n = 0
        let releaseSecond: () => void = () => {}
        const secondReady = new Promise<void>((resolve) => {
            releaseSecond = resolve
        })
        const getN = createRemoteFunction<undefined, { n: number }>({
            method: 'GET',
            url: '/rpc/getN',
            clients: BROWSER_ONLY,
            buildRequest: () => new Request('http://x/rpc/getN'),
            invoke: async () => {
                n += 1
                /* The revalidation invoke parks so refreshing() is observable mid-flight. */
                if (n === 2) {
                    await secondReady
                }
                return jsonResponse({ n })
            },
        })
        expect(await getN(undefined, { ttl: 20 })).toEqual({ n: 1 })
        /* Let the ttl deadline pass. Revalidation is access-triggered, so merely
           waiting fires nothing — an untouched entry never polls on its own. */
        await new Promise((resolve) => setTimeout(resolve, 40))
        expect(refreshing(getN)).toBe(false)
        /* The next read sees the stale deadline: it serves the stale value now and
           kicks a background revalidation (n === 2, parked) — never blanks. */
        expect(await getN(undefined, { ttl: 20 })).toEqual({ n: 1 })
        expect(refreshing(getN)).toBe(true)
        releaseSecond()
        await settle()
        expect(refreshing(getN)).toBe(false)
        expect(await getN(undefined, { ttl: 20 })).toEqual({ n: 2 })
    })
})
