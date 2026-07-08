import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { abideLog } from '../src/lib/shared/abideLog.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import { sharedCacheStoreSlot } from '../src/lib/shared/sharedCacheStoreSlot.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }

/* A JSON Response the smart call's decode path accepts. */
function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json' },
    })
}

/* A remote whose invoke count is controlled by the caller — shared across the
   shared-store and outside-a-request describes below. Endpoint cache policy
   (ADR-0020) rides on the definition, not the call. */
function countingRemote(
    url: string,
    onInvoke: () => number,
    cache?: { ttl?: number; shared?: boolean; tags?: string[] },
) {
    return createRemoteFunction<undefined, { n: number }>({
        method: 'GET',
        url,
        clients: BROWSER_ONLY,
        buildRequest: () => new Request(`http://x${url}`),
        invoke: async () => jsonResponse({ n: onInvoke() }),
        cache,
    })
}

/* Type-level coverage (tsgo validates the body, never executed): the endpoint cache
   policy accepts `shared` alongside the retention/refetch options, and the bare call
   takes only args. */
function assertSharedOptionTypechecks(): void {
    const getThing = createRemoteFunction<undefined, { id: string }>({
        method: 'GET',
        url: '/rpc/getThing',
        clients: BROWSER_ONLY,
        buildRequest: () => new Request('http://x/rpc/getThing'),
        invoke: async () => jsonResponse({ id: '1' }),
        cache: { shared: true, ttl: 20, tags: ['a'] },
    })
    void getThing(undefined)
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

    test('shared without ttl is coalesce-only on the server — a later request re-fetches', async () => {
        let invokes = 0
        const getShared = countingRemote(
            '/rpc/getShared',
            () => {
                invokes += 1
                return invokes
            },
            { shared: true },
        )
        await runWithRequestScope(new Request('http://x/'), { logRequests: false }, async () => {
            await getShared(undefined)
            return new Response('ok')
        })
        await runWithRequestScope(new Request('http://x/'), { logRequests: false }, async () => {
            await getShared(undefined)
            return new Response('ok')
        })
        expect(invokes).toBe(2)
        await settle()
        expect(sharedStore.entries.size).toBe(0)
    })

    test('shared + ttl memoizes across requests', async () => {
        let invokes = 0
        const getRates = countingRemote(
            '/rpc/getRates',
            () => {
                invokes += 1
                return invokes
            },
            { shared: true, ttl: 60_000 },
        )
        for (let i = 0; i < 2; i += 1) {
            await runWithRequestScope(
                new Request('http://x/'),
                { logRequests: false },
                async () => {
                    await getRates(undefined)
                    return new Response('ok')
                },
            )
        }
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

    test('server: ttl > 0 without shared warns that a request-scoped ttl is dead', async () => {
        const warnings: string[] = []
        const realWarn = abideLog.warn
        abideLog.warn = ((message: string) => {
            warnings.push(message)
        }) as typeof abideLog.warn
        try {
            const getWarn = countingRemote('/rpc/getWarn', () => 1, { ttl: 5000 })
            const getFine = countingRemote('/rpc/getFine', () => 1, { shared: true, ttl: 5000 })
            await runWithRequestScope(
                new Request('http://x/'),
                { logRequests: false },
                async () => {
                    await getWarn(undefined)
                    await getFine(undefined)
                    return new Response('ok')
                },
            )
            expect(warnings.some((message) => message.includes('request-scoped ttl'))).toBe(true)
            expect(
                warnings.filter((message) => message.includes('request-scoped ttl')).length,
            ).toBe(1)
        } finally {
            abideLog.warn = realWarn
        }
    })
})

describe('smart bare rpc call', () => {
    /* Mirror the server entry's resolver so the request-scoped store this test
       exercises is the actual per-request ALS store. Also wire a shared-store
       resolver to a distinct store — sharedCacheStore() degrades to
       activeCacheStore() when no shared resolver is registered (a test-only
       convenience), which would otherwise make it alias the request store and
       falsely trip the `store !== sharedCacheStore()` request-scope guard. */
    let sharedStore = createCacheStore()
    beforeEach(() => {
        sharedStore = createCacheStore()
        sharedCacheStoreSlot.resolver = () => sharedStore
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterEach(() => {
        sharedCacheStoreSlot.resolver = undefined
        cacheStoreSlot.resolver = undefined
    })

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
    /* SWR retention is a client-only concern (Task 2): every test in this describe
       exercises the smart read's unconditional retain/staleness machinery, which
       only engages when `typeof window !== 'undefined'`. */
    useBrowserWindow()
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('client: a read retains across reads while a write re-fires (coalesce-only)', async () => {
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
            /* ttl now rides the endpoint (ADR-0020): the staleness deadline is fixed here. */
            cache: { ttl: 20 },
        })
        expect(await getN(undefined)).toEqual({ n: 1 })
        /* Let the ttl deadline pass. Revalidation is access-triggered, so merely
           waiting fires nothing — an untouched entry never polls on its own. */
        await new Promise((resolve) => setTimeout(resolve, 40))
        expect(refreshing(getN)).toBe(false)
        /* The next read sees the stale deadline: it serves the stale value now and
           kicks a background revalidation (n === 2, parked) — never blanks. */
        expect(await getN(undefined)).toEqual({ n: 1 })
        expect(refreshing(getN)).toBe(true)
        releaseSecond()
        await settle()
        expect(refreshing(getN)).toBe(false)
        expect(await getN(undefined)).toEqual({ n: 2 })
    })
})

describe('smart bare rpc call — outside a request', () => {
    let sharedStore = createCacheStore()
    beforeEach(() => {
        sharedStore = createCacheStore()
        sharedCacheStoreSlot.resolver = () => sharedStore
        /* Mirror the fixed server entry: no request scope → the shared store. */
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache ?? sharedStore
        cacheStoreSlot.fallback = undefined
    })
    afterEach(() => {
        sharedCacheStoreSlot.resolver = undefined
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('a bare read with no request in flight coalesces in the shared store', async () => {
        let invokes = 0
        const getThing = countingRemote('/rpc/getOutside', () => {
            invokes += 1
            return invokes
        })
        /* Fired concurrently (not sequentially awaited): the coalesce-only default
           still shares one in-flight call, proving both routing and dedupe. */
        const [first, second] = await Promise.all([getThing(), getThing()])
        expect(first).toEqual({ n: 1 })
        expect(second).toEqual({ n: 1 })
        expect(invokes).toBe(1)
        /* The `?? sharedStore` resolver means the lazy orphan fallback is never built. */
        expect(cacheStoreSlot.fallback).toBeUndefined()
    })

    test('a sequential non-shared read outside a request evicts on settle — coalesce only, no immortal entry', async () => {
        let invokes = 0
        const getThing = countingRemote('/rpc/getOutsideSequential', () => {
            invokes += 1
            return invokes
        })
        /* First read, outside any request scope: no `shared` option, so per
           Decision 1 it still resolves to the shared store (the `?? sharedStore`
           fallback), but must NOT be kept — this store is never request-scoped. */
        const first = await getThing()
        expect(first).toEqual({ n: 1 })
        /* Let the settle handler run: a leaked immortal entry would still be
           sitting in the shared store's `entries` map right here. */
        await settle()
        expect(sharedStore.entries.size).toBe(0)
        /* A second, later read must invoke the producer again — proving the
           first entry was truly evicted, not retained forever. */
        const second = await getThing()
        expect(second).toEqual({ n: 2 })
        expect(invokes).toBe(2)
        await settle()
        expect(sharedStore.entries.size).toBe(0)
    })
})
