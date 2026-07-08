import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { settle } from './support/settle.ts'

/* ADR-0020 client gap: the endpoint's cache/stream policy ships to the client on the
   RemoteFunction, so a client-side smart read honours the declared ttl (staleness/SWR) and the
   refetch clock (throttle/debounce) — not just the server-side read. These run under a defined
   `window` (the smart read's retain branch is client-only) with a stubbed fetch. */

const realFetch = globalThis.fetch

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

describe('remoteProxy endpoint policy — client-side (ADR-0020)', () => {
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        globalThis.fetch = realFetch
        delete (globalThis as { window?: unknown }).window
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('the proxy exposes the endpoint cache/stream policy on both variants', () => {
        const getRates = remoteProxy<{ base: string }, { rate: number }>('GET', '/rpc/rates', {
            cache: { ttl: 20, tags: (args) => ['rates:' + args.base] },
            stream: { n: 5 },
        })
        expect(getRates.cache?.ttl).toBe(20)
        expect(typeof getRates.cache?.tags).toBe('function')
        expect(getRates.stream?.n).toBe(5)
        /* readThrough may read policy off `fn` or `fn.raw` — both must carry it. */
        expect(getRates.raw.cache?.ttl).toBe(20)
    })

    test('no policy → cache/stream undefined (unchanged default)', () => {
        const plain = remoteProxy<undefined, { ok: boolean }>('GET', '/rpc/plain')
        expect(plain.cache).toBeUndefined()
        expect(plain.stream).toBeUndefined()
    })

    test('a read past the endpoint ttl revalidates in place, keeping the stale value visible', async () => {
        let n = 0
        let releaseSecond: () => void = () => {}
        const secondReady = new Promise<void>((resolve) => {
            releaseSecond = resolve
        })
        globalThis.fetch = (async () => {
            n += 1
            /* The revalidation fetch parks so refreshing() is observable mid-flight. */
            if (n === 2) {
                await secondReady
            }
            return jsonResponse({ n })
        }) as unknown as typeof fetch
        const getN = remoteProxy<undefined, { n: number }>('GET', '/rpc/policyN', {
            cache: { ttl: 20 },
        })
        expect(await getN(undefined)).toEqual({ n: 1 })
        /* Let the staleness deadline pass; revalidation is access-triggered, so waiting fires
           nothing on its own. */
        await new Promise((resolve) => setTimeout(resolve, 40))
        expect(refreshing(getN)).toBe(false)
        /* The next read is past the deadline: serves the stale value now and kicks a background
           revalidation (n === 2, parked) — proving the endpoint ttl reached the client. */
        expect(await getN(undefined)).toEqual({ n: 1 })
        expect(refreshing(getN)).toBe(true)
        releaseSecond()
        await settle()
        expect(refreshing(getN)).toBe(false)
        expect(await getN(undefined)).toEqual({ n: 2 })
    })

    test('the endpoint refetch clock (debounce) governs client invalidation — a burst collapses to one refetch', async () => {
        let fetches = 0
        globalThis.fetch = (async () => {
            fetches += 1
            return jsonResponse({ n: fetches })
        }) as unknown as typeof fetch
        const getThing = remoteProxy<undefined, { n: number }>('GET', '/rpc/policyDebounce', {
            cache: { debounce: 30 },
        })
        expect(await getThing(undefined)).toEqual({ n: 1 })
        expect(fetches).toBe(1)
        /* Three invalidations inside the debounce window — the endpoint's clock, not a call
           option — collapse to a single trailing refetch. */
        cache.invalidate(getThing)
        cache.invalidate(getThing)
        cache.invalidate(getThing)
        /* Still serving the stale value while the window is open. */
        expect(await getThing(undefined)).toEqual({ n: 1 })
        await new Promise((resolve) => setTimeout(resolve, 60))
        expect(await getThing(undefined)).toEqual({ n: 2 })
        expect(fetches).toBe(2)
    })
})
