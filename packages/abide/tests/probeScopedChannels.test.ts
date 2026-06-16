import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { pending } from '../src/lib/shared/pending.ts'
import { REMOTE_FUNCTION } from '../src/lib/shared/REMOTE_FUNCTION.ts'
import { remoteMetaStore } from '../src/lib/shared/remoteMetaStore.ts'
import type { HttpVerb } from '../src/lib/shared/types/HttpVerb.ts'
import type { RawRemoteFunction } from '../src/lib/shared/types/RawRemoteFunction.ts'
import { track } from './support/reactiveScope.ts'
import { settle } from './support/settle.ts'
import { useBrowserWindow } from './support/useBrowserWindow.ts'

/* A raw remote whose response is released manually, so a test can hold a
   flight open and observe pending() mid-flight. Records request meta so
   cache() accepts it. */
function remoteStub(method: HttpVerb, url: string) {
    let release: (response: Response) => void = () => undefined
    const fn = () => {
        const request = new Request(`https://test.local${url}`, { method })
        const promise = new Promise<Response>((resolve) => {
            release = resolve
        })
        remoteMetaStore.set(promise, () => request)
        return promise
    }
    return {
        fn: Object.assign(fn, {
            method,
            url,
            [REMOTE_FUNCTION]: true,
        }) as RawRemoteFunction<undefined>,
        resolve: () =>
            release(
                new Response(JSON.stringify({ ok: true }), {
                    headers: { 'content-type': 'application/json' },
                }),
            ),
    }
}

/*
A probe's lifecycle subscription is scoped to its selector: pending(fn) taps
only fn's prefix channel, so unrelated cache events — another function's
flights, invalidates, evictions — never re-run the reading scope. The hazard
this kills: an $effect that reads pending(a) and invalidates b used to be
re-woken by its own invalidate through the store-wide channel, looping across
microtasks where Svelte's depth detection can't see it.
*/
describe('selector-scoped probe channels', () => {
    useBrowserWindow()
    let store = createCacheStore()
    beforeEach(() => {
        store = createCacheStore()
        cacheStoreSlot.resolver = () => store
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
    })

    test("a fn probe ignores another function's lifecycle events", async () => {
        const a = remoteStub('GET', '/rpc/scoped-a')
        const b = remoteStub('GET', '/rpc/scoped-b')
        let runsA = 0
        let runsBare = 0
        const probeA = track(() => {
            runsA += 1
            return pending(a.fn)
        })
        const probeBare = track(() => {
            runsBare += 1
            return pending()
        })
        await settle()
        expect(runsA).toBe(1)
        const bareRunsBefore = runsBare

        const flight = cache(b.fn)()
        b.resolve()
        await flight
        await settle()
        cache.invalidate(b.fn)
        await settle()

        /* b's flight, settle, and invalidate flowed (the bare probe re-ran) but never woke a's probe. */
        expect(runsBare).toBeGreaterThan(bareRunsBefore)
        expect(runsA).toBe(1)
        expect(probeA.current()).toBe(false)
        probeA.stop()
        probeBare.stop()
    })

    test('an effect that probes one fn and invalidates another does not feed itself', async () => {
        const a = remoteStub('GET', '/rpc/scoped-loop-probe')
        const b = remoteStub('GET', '/rpc/scoped-loop-target')
        let runs = 0
        /* The MediaDetail shape: read a probe, invalidate a different selector. */
        const scope = track(() => {
            runs += 1
            pending(a.fn)
            cache.invalidate(b.fn)
        })
        await settle()
        await settle()
        await settle()

        /* The store-wide channel marked by its own invalidate is no longer a dependency. */
        expect(runs).toBe(1)
        scope.stop()
    })

    test('a fn probe still wakes for its own calls, including the first (membership)', async () => {
        const a = remoteStub('GET', '/rpc/scoped-self')
        const probeA = track(() => pending(a.fn))
        await settle()
        expect(probeA.current()).toBe(false)

        /* Entry creation marks the prefix channel — the probe armed before any entry existed sees it. */
        const flight = cache(a.fn)()
        await settle()
        expect(probeA.current()).toBe(true)

        a.resolve()
        await flight
        await settle()
        expect(probeA.current()).toBe(false)
        probeA.stop()
    })

    test('a producer probe falls back store-wide until its first cache, then narrows', async () => {
        let release: (value: string) => void = () => undefined
        function loadThing(): Promise<string> {
            return new Promise((resolve) => {
                release = resolve
            })
        }
        const other = remoteStub('GET', '/rpc/scoped-producer-other')
        let runs = 0
        const probe = track(() => {
            runs += 1
            return pending(loadThing)
        })
        await settle()
        expect(probe.current()).toBe(false)

        /* No reference id yet → the probe sits on the store-wide channel, so the first cache wakes it. */
        const flight = cache(loadThing)()
        await settle()
        expect(probe.current()).toBe(true)
        const runsAfterOpen = runs

        /* Narrowed to the minted id's prefix channel: another fn's events no longer reach it. */
        const otherFlight = cache(other.fn)()
        other.resolve()
        await otherFlight
        await settle()
        cache.invalidate(other.fn)
        await settle()
        expect(runs).toBe(runsAfterOpen)
        expect(probe.current()).toBe(true)

        release('done')
        await flight
        await settle()
        expect(probe.current()).toBe(false)
        probe.stop()
    })
})
