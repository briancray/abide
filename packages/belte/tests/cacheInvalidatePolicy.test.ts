import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { settle } from './support/settle.ts'

/* A producer reporting its own invocation count, so refetches are countable. */
function counter(): () => Promise<number> {
    let calls = 0
    return () => Promise.resolve(++calls)
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('cache() invalidate throttle / debounce', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('debounce collapses an invalidation burst into a single refetch', async () => {
        const fetchValue = counter()
        expect(await cache(fetchValue, { invalidate: { debounce: 30 } })()).toBe(1)

        cache.invalidate(fetchValue)
        cache.invalidate(fetchValue)
        cache.invalidate(fetchValue)
        /* Still serving the stale value while the debounce window is open. */
        expect(await cache(fetchValue)()).toBe(1)

        await wait(60)
        /* Exactly one refetch fired (2), not three. */
        expect(await cache(fetchValue)()).toBe(2)
    })

    test('throttle fires on the leading edge, then coalesces the window', async () => {
        const fetchValue = counter()
        expect(await cache(fetchValue, { invalidate: { throttle: 40 } })()).toBe(1)

        cache.invalidate(fetchValue) // leading edge → refetch now
        await settle()
        expect(await cache(fetchValue)()).toBe(2)

        cache.invalidate(fetchValue) // within window → trailing, coalesced
        cache.invalidate(fetchValue)
        expect(await cache(fetchValue)()).toBe(2) // not yet

        await wait(70)
        expect(await cache(fetchValue)()).toBe(3) // one trailing refetch
    })

    test('serves stale until the refetch resolves (stale-while-revalidate)', async () => {
        let resolveSecond: (value: number) => void = () => {}
        const second = new Promise<number>((resolve) => {
            resolveSecond = resolve
        })
        const values: Promise<number>[] = [Promise.resolve(1), second]
        let index = 0
        const producer = () => values[index++]

        expect(await cache(producer, { invalidate: { debounce: 10 } })()).toBe(1)
        cache.invalidate(producer)
        await wait(30) // debounce fired; the refetch is in flight (unresolved)

        expect(await cache(producer)()).toBe(1) // stale held
        resolveSecond(2)
        await settle()
        expect(await cache(producer)()).toBe(2) // fresh swapped in
    })

    test('refreshing is true only while a coalesced refetch is in flight', async () => {
        let resolveSecond: (value: number) => void = () => {}
        const second = new Promise<number>((resolve) => {
            resolveSecond = resolve
        })
        const values: Promise<number>[] = [Promise.resolve(1), second]
        let index = 0
        const producer = () => values[index++]

        expect(await cache(producer, { invalidate: { debounce: 10 } })()).toBe(1)
        /* Settled value present, nothing in flight → not refreshing, not pending. */
        expect(cache.refreshing(producer)).toBe(false)
        expect(cache.pending(producer)).toBe(false)

        cache.invalidate(producer)
        await wait(30) // debounce fired; the refetch is unresolved

        /* Stale value still visible (pending stays false) but a refetch is in flight. */
        expect(cache.refreshing(producer)).toBe(true)
        expect(cache.pending(producer)).toBe(false)

        resolveSecond(2)
        await settle()
        expect(cache.refreshing(producer)).toBe(false)
        expect(await cache(producer)()).toBe(2)
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

        await cache(slowProducer, { invalidate: { debounce: 10 } })()
        await cache(fastProducer, { invalidate: { debounce: 10 } })()

        cache.invalidate(slowProducer)
        await wait(30)
        expect(cache.refreshing(slowProducer)).toBe(true)
        expect(cache.refreshing(fastProducer)).toBe(false)

        resolveSecond(2)
        await settle()
    })

    test('a rejected refetch keeps the stale value', async () => {
        let calls = 0
        const producer = () => {
            calls += 1
            return calls === 1 ? Promise.resolve('ok') : Promise.reject(new Error('boom'))
        }
        expect(await cache(producer, { invalidate: { debounce: 10 } })()).toBe('ok')

        cache.invalidate(producer)
        await wait(30)
        expect(await cache(producer)()).toBe('ok')
    })

    test('without a policy, invalidate still drops the entry immediately', async () => {
        const fetchValue = counter()
        await cache(fetchValue)()
        cache.invalidate(fetchValue)
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
    })
})
