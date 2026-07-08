import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import type { CacheStore } from '../src/lib/shared/types/CacheStore.ts'
import type { HttpMethod } from '../src/lib/shared/types/HttpMethod.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import { track } from './support/reactiveScope.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/* A raw remote that records request meta so cache() accepts it as a remote. Endpoint
   cache policy (ADR-0020) rides on the definition — no call-site options for a remote. */
function remote(
    method: HttpMethod,
    url: string,
    cachePolicy?: { ttl?: number },
): RawRemoteFunction<undefined> {
    const fn = () => {
        const request = new Request(`https://test.local${url}`, { method })
        const promise = Promise.resolve(
            new Response(JSON.stringify({ ok: true }), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        remoteMetaStore.set(promise, () => request)
        return promise
    }
    return Object.assign(fn, { method, url, cache: cachePolicy, [REMOTE_FUNCTION]: true })
}

/*
The reload marker (pendingRefresh) is what makes the read after a policy-less
invalidate report refreshing() instead of a first-ever load. On the long-lived
tab store it is bounded from both ends, and both ends matter — between them a
marker that would otherwise linger forever has nowhere to accrete:

  - GATED ON A READER: invalidate adds a marker only when a reactive scope is
    holding the key's value (hasReader). A key invalidated with nothing on screen
    (e.g. a ttl-retained list after navigating away) gets no marker — the next
    read is a fresh mount, a first load, not a reload.
  - PRUNED ON TEARDOWN: a marker added while a reader was present, whose scope
    then tears down before re-reading the key, is dropped by the subscriber's
    cleanup — nothing left to reload into.

These run client-side (a tracking scope + the module-level tab store), so the
suite drives real abide-ui effects via track() under a browser window.
*/
describe('pendingRefresh garbage collection', () => {
    useBrowserWindow()
    let store: CacheStore
    beforeEach(() => {
        store = createCacheStore()
        cacheStoreSlot.resolver = () => store
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('a ttl-retained entry invalidated with no live reader leaves no marker', async () => {
        const get = remote('GET', '/rpc/gc-no-reader', { ttl: 60_000 })
        const tracked = track(() => cache(get))
        await settle()
        /* Reader unmounts; the ttl keeps the entry but the subscriber is gone. */
        tracked.stop()
        await settle()
        expect(store.entries.has('GET /rpc/gc-no-reader')).toBe(true)

        cache.invalidate(get)
        await settle()

        /* No reader was holding the value, so no reload marker was minted. */
        expect(store.pendingRefresh.has('GET /rpc/gc-no-reader')).toBe(false)
    })

    test('a marker minted for a live reader is pruned when that reader tears down without re-reading', async () => {
        const get = remote('GET', '/rpc/gc-teardown')
        let readsKey = true
        const tracked = track(() => (readsKey ? cache(get) : undefined))
        await settle()

        /* Next re-run will not read the key — the marker has no consumer. */
        readsKey = false
        cache.invalidate(get)
        await settle()
        /* Reader present at invalidate → marker minted, and it lingered because the
           re-run skipped the read. */
        expect(store.pendingRefresh.has('GET /rpc/gc-teardown')).toBe(true)

        tracked.stop()
        await settle()
        /* Subscriber cleanup drops the orphaned marker. */
        expect(store.pendingRefresh.has('GET /rpc/gc-teardown')).toBe(false)
    })

    test('the normal invalidate→reread path still flags the reload (gc did not eat the live case)', async () => {
        const get = remote('GET', '/rpc/gc-live')
        /* A reader that always re-reads the key after an invalidate. */
        const tracked = track(() => cache(get))
        await settle()

        /* emit() re-runs the tracking scope synchronously, so the reread consumes the
           marker inside this invalidate() call — and registerEntry turns it into a
           reload flag on the fresh in-flight entry. That flag is the whole point of
           the marker; the gate must not suppress it for an on-screen reader. */
        cache.invalidate(get)
        expect(store.entries.get('GET /rpc/gc-live')?.refreshing).toBe(true)
        expect(store.pendingRefresh.has('GET /rpc/gc-live')).toBe(false)

        await settle()
        /* Reload landed — fresh data, no longer refreshing. */
        expect(store.entries.get('GET /rpc/gc-live')?.refreshing).toBe(false)
        tracked.stop()
    })
})
