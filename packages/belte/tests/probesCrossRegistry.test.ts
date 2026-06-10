import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { tail } from '../src/lib/browser/tail.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { track } from './support/reactiveScope.svelte.ts'
import { reconnectable } from './support/reconnectable.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/*
pending() spans both registries: cache entries by selector, streams by
Subscribable (no value yet ≙ tail.status 'pending') — and the bare form
unions them. Probes report, never act: probing a stream must not open it.
*/
describe('pending() across registries', () => {
    useBrowserWindow()
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('probing a stream nobody subscribed reports pending without opening it', () => {
        const { subscribable, connections } = reconnectable<string>('feed-probe-passive')
        expect(pending(subscribable)).toBe(true)
        expect(connections).toHaveLength(0)
    })

    test('pending(subscribable) flips false on the first frame', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-probe-first-frame')
        const latest = track(() => tail(subscribable))
        const waiting = track(() => pending(subscribable))

        await settle()
        expect(waiting.current()).toBe(true)

        connections[0].push('a')
        await settle()
        expect(waiting.current()).toBe(false)
        expect(latest.current()).toBe('a')

        latest.stop()
        waiting.stop()
    })

    test('pending(subscribable) spans window entries — probes match by source, not key', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-probe-window')
        const recent = track(() => tail(subscribable, { last: 2 }))
        const waiting = track(() => pending(subscribable))

        await settle()
        /* Only a window entry exists for this source; the name-form probe still sees it. */
        expect(waiting.current()).toBe(true)

        connections[0].push('a')
        await settle()
        expect(waiting.current()).toBe(false)
        expect(recent.current()).toEqual(['a'])

        recent.stop()
        waiting.stop()
    })

    test('the bare form spans registries: a stream awaiting its first frame counts', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-probe-bare')
        const latest = track(() => tail(subscribable))
        const anything = track(() => pending())

        await settle()
        /* No cache entries in flight; the cold stream alone holds the bare form true. */
        expect(anything.current()).toBe(true)

        connections[0].push('a')
        await settle()
        expect(anything.current()).toBe(false)

        latest.stop()
        anything.stop()
    })
})
