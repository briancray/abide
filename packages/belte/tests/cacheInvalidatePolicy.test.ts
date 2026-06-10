import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { pending } from '../src/lib/shared/pending.ts'
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

    test('a read declaring a policy arms an existing entry that lacks one', async () => {
        const fetchValue = counter()
        /* First read declares no policy — the entry starts bare. */
        expect(await cache(fetchValue)()).toBe(1)
        /* A later read (hit) declares one; it attaches like a scope tag would. */
        expect(await cache(fetchValue, { invalidate: { debounce: 10 } })()).toBe(1)

        cache.invalidate(fetchValue)
        /* Kept and revalidating in place, not hard-dropped to a pending flash. */
        expect(cacheStoreSlot.fallback!.entries.size).toBe(1)
        expect(await cache(fetchValue)()).toBe(1) // stale served

        await wait(30)
        expect(await cache(fetchValue)()).toBe(2) // coalesced refetch landed
    })

    test('eviction disarms an armed policy timer (no refetch of a dead key)', async () => {
        const fetchValue = counter()
        expect(await cache(fetchValue, { ttl: 20, invalidate: { debounce: 30 } })()).toBe(1)

        cache.invalidate(fetchValue) // arms the 30ms debounce
        await wait(25) // ttl expiry evicts the entry first, clearing the timer
        expect(cacheStoreSlot.fallback!.entries.size).toBe(0)

        await wait(30) // past the debounce window — the refetch must not have fired
        expect(await cache(fetchValue)()).toBe(2) // 2: this read, not a ghost refetch
    })

    test('without a policy, the next read after invalidate reports as a reload', async () => {
        let resolveSecond: (value: number) => void = () => {}
        const second = new Promise<number>((resolve) => {
            resolveSecond = resolve
        })
        const values: Promise<number>[] = [Promise.resolve(1), second]
        let index = 0
        const producer = () => values[index++]

        expect(await cache(producer)()).toBe(1)
        /* A settled cold load is not a reload. */
        expect(refreshing(producer)).toBe(false)

        cache.invalidate(producer) // drops the entry, marks the key for refresh

        /* The next read is a cold miss (no stale value → also pending), but flagged
           a reload because it follows an invalidate. */
        const reload = cache(producer)()
        expect(refreshing(producer)).toBe(true)
        expect(pending(producer)).toBe(true)

        resolveSecond(2)
        expect(await reload).toBe(2)
        await settle()
        /* Reload settled → fresh value, no longer refreshing. */
        expect(refreshing(producer)).toBe(false)
        expect(pending(producer)).toBe(false)
    })
})

/*
Wrap-time guards: impossible policy combinations throw where the call site is
on the stack, not at some later invalidate. A policy declares "safe to re-run
unprompted", so a write method must never carry one; ttl: 0 retains nothing for
a policy to revalidate; the two coalescing strategies are exclusive.
*/
describe('cache() invalidate policy guards', () => {
    const readPost = defineVerb('GET', '/rpc/policy-read', () => json({ ok: true }))
    const writePost = defineVerb('POST', '/rpc/policy-write', () => json({ ok: true }))

    test('throttle and debounce together throw', () => {
        const fetchValue = () => Promise.resolve(1)
        expect(() => cache(fetchValue, { invalidate: { throttle: 10, debounce: 10 } })).toThrow(
            'not both',
        )
    })

    test('ttl: 0 with a policy throws — nothing retained, nothing to revalidate', () => {
        const fetchValue = () => Promise.resolve(1)
        expect(() => cache(fetchValue, { ttl: 0, invalidate: { throttle: 10 } })).toThrow(
            'requires retention',
        )
    })

    test('a policy on a write method throws; on a read it wraps fine', () => {
        expect(() => cache(writePost, { invalidate: { throttle: 10 } })).toThrow(
            'must not be replayed',
        )
        expect(() => cache(readPost, { invalidate: { throttle: 10 } })).not.toThrow()
    })

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
