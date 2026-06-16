import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import type { HttpVerb } from '../src/lib/shared/types/HttpVerb.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import { trackDerived } from './support/derivedScope.ts'
import { track } from './support/reactiveScope.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/* A raw remote whose body reports its own invocation count, so a refetch is
   visible in the response (n grows) and a dedupe holds n steady. Records request
   meta so cache() accepts it. */
function countingRemote(method: HttpVerb, url: string): RawRemoteFunction<undefined> {
    let calls = 0
    const fn = () => {
        calls += 1
        const request = new Request(`https://test.local${url}`, { method })
        const promise = Promise.resolve(
            new Response(JSON.stringify({ n: calls }), {
                headers: { 'content-type': 'application/json' },
            }),
        )
        remoteMetaStore.set(promise, () => request)
        return promise
    }
    // Object.assign's intersection satisfies RawRemoteFunction structurally — no cast needed.
    return Object.assign(fn, { method, url, [REMOTE_FUNCTION]: true })
}

/*
cache() registers the surrounding tracking scope via store.subscribe(key); a
later cache.invalidate(fn) re-runs that scope, which calls cache() again and
takes the miss path — a fresh fetch. Drive that loop through a real $effect
scope (window present so the browser branch is live) and assert the read both
dedupes within a render and refetches after an invalidate.
*/
describe('cache() reactive refetch', () => {
    useBrowserWindow()
    let store = createCacheStore()
    beforeEach(() => {
        store = createCacheStore()
        cacheStoreSlot.resolver = () => store
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('a tracked read invalidated by fn refetches and re-runs the scope', async () => {
        const get = countingRemote('GET', '/rpc/thing')
        const tracked = track(() => cache(get)())

        await settle()
        expect(await tracked.current()!.then((r) => r.json())).toEqual({ n: 1 })

        cache.invalidate(get)
        await settle()

        // The invalidate woke the scope, which refetched — n advances to 2.
        expect(await tracked.current()!.then((r) => r.json())).toEqual({ n: 2 })
        tracked.stop()
    })

    test('without an invalidate the tracked read stays deduped', async () => {
        const get = countingRemote('GET', '/rpc/stable')
        const tracked = track(() => cache(get)())

        await settle()
        const first = tracked.current()
        await settle()
        const second = tracked.current()

        // No invalidate → the scope never re-ran, so the same cached promise is
        // handed back and the underlying call ran exactly once.
        expect(second).toBe(first)
        expect(await first!.then((r) => r.json())).toEqual({ n: 1 })
        tracked.stop()
    })

    /*
    A live pending()/refreshing() probe arms the lifecycle channel's notifier.
    A cold read taken inside a $derived (the documented read idiom) then calls
    registerEntry, which marks the channel — if the mark writes subscriber
    state synchronously, Svelte throws state_unsafe_mutation mid-derived and
    the flush dies. The mark must reach the probe without a write inside the
    derived's evaluation.
    */
    test('a cold read inside $derived with a live probe does not throw', async () => {
        const get = countingRemote('GET', '/rpc/derived-cold')
        const probe = track(() => pending(get))
        await settle()
        expect(probe.current()).toBe(false)

        const tracked = trackDerived(() => cache(get)())
        await settle()

        // The read survived derived evaluation and the probe saw the settle.
        expect(await tracked.current()!.then((r) => r.json())).toEqual({ n: 1 })
        expect(probe.current()).toBe(false)
        tracked.stop()
        probe.stop()
    })
})
