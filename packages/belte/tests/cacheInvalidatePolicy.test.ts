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

        expect(await cache(producer, { key: 'swr', invalidate: { debounce: 10 } })()).toBe(1)
        cache.invalidate({ key: 'swr' })
        await wait(30) // debounce fired; the refetch is in flight (unresolved)

        expect(await cache(producer, { key: 'swr' })()).toBe(1) // stale held
        resolveSecond(2)
        await settle()
        expect(await cache(producer, { key: 'swr' })()).toBe(2) // fresh swapped in
    })

    test('a rejected refetch keeps the stale value', async () => {
        let calls = 0
        const producer = () => {
            calls += 1
            return calls === 1 ? Promise.resolve('ok') : Promise.reject(new Error('boom'))
        }
        expect(await cache(producer, { key: 'keep', invalidate: { debounce: 10 } })()).toBe('ok')

        cache.invalidate({ key: 'keep' })
        await wait(30)
        expect(await cache(producer, { key: 'keep' })()).toBe('ok')
    })

    test('without a policy, invalidate still drops the entry immediately', async () => {
        const fetchValue = counter()
        await cache(fetchValue)()
        cache.invalidate(fetchValue)
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)
    })
})
