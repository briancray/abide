import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { done } from '../src/lib/shared/done.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { refreshing } from '../src/lib/shared/refreshing.ts'
import { watch } from '../src/lib/ui/watch.ts'
import { track } from './support/reactiveScope.ts'
import { reconnectable } from './support/reconnectable.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/*
Register-on-consume for subscribable probes: consuming a socket/stream via
watch() (→ cache.on) populates the probe registry, so pending()/refreshing()/
done()(source) report — the stream-side analog of a call populating the cache
store. Replaces tail()'s registrar role (tail() removed). Probes report, never
act: probing a stream nobody consumes opens nothing.
*/
describe('subscribable probes — register on consume', () => {
    useBrowserWindow()
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
    })

    test('probing a stream nobody consumes reports pending without opening it', () => {
        const { subscribable, connections } = reconnectable<string>('feed-passive')
        expect(pending(subscribable)).toBe(true)
        expect(connections).toHaveLength(0)
    })

    test('pending(subscribable) flips false on the first frame', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-first')
        const stop = watch(subscribable, () => undefined)
        const waiting = track(() => pending(subscribable))
        await settle()
        expect(waiting.current()).toBe(true)

        connections[0].push('a')
        await settle()
        expect(waiting.current()).toBe(false)

        waiting.stop()
        stop()
    })

    test('refreshing flips true across a reconnect gap (value held), false on the next frame', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-gap')
        const stop = watch(subscribable, () => undefined)
        const gap = track(() => refreshing(subscribable))
        await settle()

        connections[0].push('a')
        await settle()
        expect(gap.current()).toBe(false)

        connections[0].disconnect()
        await settle()
        /* Value seen before the gap → refreshing; a fresh connection reopened. */
        expect(gap.current()).toBe(true)
        expect(connections).toHaveLength(2)

        connections[1].push('b')
        await settle()
        expect(gap.current()).toBe(false)

        gap.stop()
        stop()
    })

    test('a disconnect before the first frame stays pending — nothing to refresh', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-cold-gap')
        const stop = watch(subscribable, () => undefined)
        const waiting = track(() => pending(subscribable))
        const gap = track(() => refreshing(subscribable))
        await settle()

        connections[0].disconnect()
        await settle()
        expect(waiting.current()).toBe(true)
        expect(gap.current()).toBe(false)
        expect(connections).toHaveLength(2)

        waiting.stop()
        gap.stop()
        stop()
    })

    test('done(subscribable) flips true when the stream ends cleanly', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-done')
        const stop = watch(subscribable, () => undefined)
        const finished = track(() => done(subscribable))
        await settle()
        expect(finished.current()).toBe(false)

        connections[0].push('a')
        connections[0].end()
        await settle()
        expect(finished.current()).toBe(true)

        finished.stop()
        stop()
    })

    test('the last consumer leaving during a gap cancels the reconnect and evicts the entry', async () => {
        const { subscribable, connections } = reconnectable<string>('feed-cancel')
        const stop = watch(subscribable, () => undefined)
        await settle()
        connections[0].push('a')
        await settle()
        connections[0].disconnect()
        await settle()
        expect(connections).toHaveLength(2)

        stop()
        /* Teardown evicts the probe entry; a probe now reads the neutral no-consumer state. */
        connections[1].push('b')
        await settle()
        expect(pending(subscribable)).toBe(true)
    })
})
