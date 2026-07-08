import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { HttpError } from '../src/lib/shared/HttpError.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { producerKey } from '../src/lib/shared/producerKey.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import { settle } from './support/settle.ts'

/* A producer reporting its own invocation count, so refetches are countable. */
function counter(): () => Promise<number> {
    let calls = 0
    return () => Promise.resolve(++calls)
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('cache() producer refetch policy (stale-while-revalidate)', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('a windowless (throttle: 0) policy keeps the stale value and refetches immediately on every invalidate', async () => {
        const fetchValue = counter()
        expect(await cache(fetchValue, undefined, { throttle: 0 })).toBe(1)

        cache.invalidate(fetchValue)
        await settle()
        /* No window → the refetch fired now; the stale 1 was held until it landed. */
        expect(await cache(fetchValue)).toBe(2)
        /* Entry kept (revalidated in place), never dropped to a pending flash. */
        expect(cacheStoreSlot.fallback!.entries.size).toBe(1)

        cache.invalidate(fetchValue)
        await settle()
        expect(await cache(fetchValue)).toBe(3)
    })

    test('debounce collapses an invalidation burst into a single refetch', async () => {
        const fetchValue = counter()
        expect(await cache(fetchValue, undefined, { debounce: 30 })).toBe(1)

        cache.invalidate(fetchValue)
        cache.invalidate(fetchValue)
        cache.invalidate(fetchValue)
        /* Still serving the stale value while the debounce window is open. */
        expect(await cache(fetchValue)).toBe(1)

        await wait(60)
        /* Exactly one refetch fired (2), not three. */
        expect(await cache(fetchValue)).toBe(2)
    })

    test('throttle fires on the leading edge, then coalesces the window', async () => {
        const fetchValue = counter()
        expect(await cache(fetchValue, undefined, { throttle: 40 })).toBe(1)

        cache.invalidate(fetchValue) // leading edge → refetch now
        await settle()
        expect(await cache(fetchValue)).toBe(2)

        cache.invalidate(fetchValue) // within window → trailing, coalesced
        cache.invalidate(fetchValue)
        expect(await cache(fetchValue)).toBe(2) // not yet

        await wait(70)
        expect(await cache(fetchValue)).toBe(3) // one trailing refetch
    })

    test('serves stale until the refetch resolves (stale-while-revalidate)', async () => {
        let resolveSecond: (value: number) => void = () => {}
        const second = new Promise<number>((resolve) => {
            resolveSecond = resolve
        })
        const values: Promise<number>[] = [Promise.resolve(1), second]
        let index = 0
        const producer = () => values[index++]

        expect(await cache(producer, undefined, { debounce: 10 })).toBe(1)
        cache.invalidate(producer)
        await wait(30) // debounce fired; the refetch is in flight (unresolved)

        expect(await cache(producer)).toBe(1) // stale held
        resolveSecond(2)
        await settle()
        expect(await cache(producer)).toBe(2) // fresh swapped in
    })

    test('refreshing is true only while a coalesced refetch is in flight', async () => {
        let resolveSecond: (value: number) => void = () => {}
        const second = new Promise<number>((resolve) => {
            resolveSecond = resolve
        })
        const values: Promise<number>[] = [Promise.resolve(1), second]
        let index = 0
        const producer = () => values[index++]

        expect(await cache(producer, undefined, { debounce: 10 })).toBe(1)
        /* Settled value present, nothing in flight → not refreshing, not pending. */
        expect(refreshing(producer)).toBe(false)
        expect(pending(producer)).toBe(false)

        cache.invalidate(producer)
        await wait(30) // debounce fired; the refetch is unresolved

        /* Stale value still visible (pending stays false) but a refetch is in flight. */
        expect(refreshing(producer)).toBe(true)
        expect(pending(producer)).toBe(false)

        resolveSecond(2)
        await settle()
        expect(refreshing(producer)).toBe(false)
        expect(await cache(producer)).toBe(2)
    })

    test('refreshing selector ignores other revalidating entries', async () => {
        let resolveSecond: (value: number) => void = () => {}
        const blocked = new Promise<number>((resolve) => {
            resolveSecond = resolve
        })
        const slow = [Promise.resolve(1), blocked]
        let slowIndex = 0
        const slowProducer = () => slow[slowIndex++]
        const fastProducer = counter()

        await cache(slowProducer, undefined, { debounce: 10 })
        await cache(fastProducer, undefined, { debounce: 10 })

        cache.invalidate(slowProducer)
        await wait(30)
        expect(refreshing(slowProducer)).toBe(true)
        expect(refreshing(fastProducer)).toBe(false)

        resolveSecond(2)
        await settle()
    })

    test('a rejected refetch keeps the stale value', async () => {
        let calls = 0
        const producer = () => {
            calls += 1
            return calls === 1 ? Promise.resolve('ok') : Promise.reject(new Error('boom'))
        }
        expect(await cache(producer, undefined, { debounce: 10 })).toBe('ok')

        cache.invalidate(producer)
        await wait(30)
        expect(await cache(producer)).toBe('ok')
    })

    test('a refetch rejecting with HttpError 404 evicts the entry (resource gone)', async () => {
        let calls = 0
        const producer = () => {
            calls += 1
            return calls === 1
                ? Promise.resolve('ok')
                : Promise.reject(new HttpError(new Response(undefined, { status: 404 })))
        }
        expect(await cache(producer, undefined, { debounce: 10 })).toBe('ok')

        cache.invalidate(producer)
        await wait(30)
        /* Not retained — a 404 on revalidation means the resource no longer exists. */
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
        /* These are bare reads, so nothing is holding the key on screen — the eviction
           mints no reload marker (a future mount is a first load, not a reload). The
           reader-present flag path is covered by cachePendingRefreshGc. */
        expect(cacheStoreSlot.fallback!.pendingRefresh.has(producerKey(producer, undefined))).toBe(
            false,
        )
    })

    test('a refetch resolving a 404 Response evicts instead of swapping the error in', async () => {
        /* Remote refetches resolve with the Response even on error statuses. */
        let calls = 0
        const producer = () => {
            calls += 1
            return Promise.resolve(
                calls === 1 ? new Response('ok') : new Response(undefined, { status: 404 }),
            )
        }
        await cache(producer, undefined, { debounce: 10 })
        expect(cacheStoreSlot.fallback!.entries.size).toBe(1)

        cache.invalidate(producer)
        await wait(30)
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
    })

    test('a refetch resolving a non-404 error Response keeps the stale entry', async () => {
        let calls = 0
        const producer = () => {
            calls += 1
            return Promise.resolve(
                calls === 1 ? new Response('ok') : new Response(undefined, { status: 500 }),
            )
        }
        const first = await cache(producer, undefined, { debounce: 10 })

        cache.invalidate(producer)
        await wait(30)
        /* The 500 result was discarded — the entry still serves the original Response. */
        expect(cacheStoreSlot.fallback!.entries.size).toBe(1)
        expect(await cache(producer)).toBe(first)
    })

    test('without a policy, invalidate still drops the entry immediately', async () => {
        const fetchValue = counter()
        await cache(fetchValue)
        cache.invalidate(fetchValue)
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
    })

    test('a read declaring a policy arms an existing entry that lacks one', async () => {
        const fetchValue = counter()
        /* First read declares no policy — the entry starts bare. */
        expect(await cache(fetchValue)).toBe(1)
        /* A later read (hit) declares one; it attaches like a tag would. */
        expect(await cache(fetchValue, undefined, { debounce: 10 })).toBe(1)

        cache.invalidate(fetchValue)
        /* Kept and revalidating in place, not hard-dropped to a pending flash. */
        expect(cacheStoreSlot.fallback!.entries.size).toBe(1)
        expect(await cache(fetchValue)).toBe(1) // stale served

        await wait(30)
        expect(await cache(fetchValue)).toBe(2) // coalesced refetch landed
    })

    test('eviction disarms an armed policy timer (no refetch of a dead key)', async () => {
        const fetchValue = counter()
        expect(await cache(fetchValue, undefined, { ttl: 20, debounce: 30 })).toBe(1)

        cache.invalidate(fetchValue) // arms the 30ms debounce
        await wait(25) // ttl expiry evicts the entry first, clearing the timer
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)

        await wait(30) // past the debounce window — the refetch must not have fired
        expect(await cache(fetchValue)).toBe(2) // 2: this read, not a ghost refetch
    })

    test('without a live reader, the next read after invalidate is a first load, not a reload', async () => {
        let resolveSecond: (value: number) => void = () => {}
        const second = new Promise<number>((resolve) => {
            resolveSecond = resolve
        })
        let index = 0
        const producer = () => (index++ === 0 ? Promise.resolve(1) : second)

        expect(await cache(producer)).toBe(1)
        /* A settled cold load is not a reload. */
        expect(refreshing(producer)).toBe(false)

        /* Bare reads don't subscribe, so nothing is holding this key on screen.
           invalidate drops the entry but mints no reload marker — the next read is a
           fresh mount, a first-ever load, not a reload. (The reader-present reload-flag
           path is covered by cachePendingRefreshGc's live case.) */
        cache.invalidate(producer)

        const reload = cache(producer)
        expect(refreshing(producer)).toBe(false)
        expect(pending(producer)).toBe(true)

        resolveSecond(2)
        expect(await reload).toBe(2)
        await settle()
        expect(refreshing(producer)).toBe(false)
        expect(pending(producer)).toBe(false)
    })
})

/*
The old wrap-time swr guards (throttle+debounce together, swr-on-ttl:0,
swr-on-a-write) are gone with the `swr` toggle (ADR-0020): SWR is unconditional
for replayable reads, a write carries no cache policy at all (kind-scoped opts —
a compile error, not a runtime throw), and a producer's throttle/debounce window
is the plain refetch clock. What remains is the anonymous-producer warning.
*/
describe('cache() producer wrap warnings', () => {
    test('an anonymous producer warns once per call site', () => {
        const warned: string[] = []
        const original = console.warn
        /* Hoisted outside the try: Bun drops inferred arrow names inside try blocks. */
        const hoisted = () => Promise.resolve('anon-warn-probe-named')
        console.warn = (message: string) => {
            warned.push(message)
        }
        try {
            cache(() => Promise.resolve('anon-warn-probe'))
            cache(() => Promise.resolve('anon-warn-probe'))
            cache(hoisted)
        } finally {
            console.warn = original
        }
        /* Two wraps, one distinct source → one warning; the named binding stays silent. */
        expect(warned.filter((message) => message.includes('anonymous function'))).toHaveLength(1)
    })
})
