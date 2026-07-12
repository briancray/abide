import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { createCacheStore } from '../src/lib/shared/createCacheStore.ts'
import { createRemoteFunction } from '../src/lib/shared/createRemoteFunction.ts'
import { hydrationWindow } from '../src/lib/shared/hydrationWindow.ts'
import { keyForRemoteCall } from '../src/lib/shared/keyForRemoteCall.ts'
import { peek } from '../src/lib/shared/peek.ts'
import type { CacheSnapshotEntry } from '../src/lib/shared/types/CacheSnapshotEntry.ts'
import { effect } from '../src/lib/ui/effect.ts'
import { seedStreamedResolution } from '../src/lib/ui/seedStreamedResolution.ts'
import { settle } from './support/settle.ts'

/*
ADR-0024 D3: `seedStreamedResolution` fires `store.markLifecycle(key)` after seeding the
streamed cache entry. The await path relied on seed-before-mount ordering (its subscription
reads the resume manifest, not the cache), but an auto-streamed BARE read has already mounted
and its throwing-peek subscribed the key's lifecycle channel — so without the explicit wake a
peek that read `undefined` at flush never re-runs when the streamed value lands. This drives
the exact seam: a peek subscribed via `effect`, then a streamed resolution, and asserts the
peek scope re-runs and now sees the value.
*/

const BROWSER_ONLY = { browser: true, mcp: false, cli: false }
const URL = 'http://x/rpc/streamWake'

const getUser = createRemoteFunction<undefined, { id: string }>({
    method: 'GET',
    url: '/rpc/streamWake',
    clients: BROWSER_ONLY,
    buildRequest: () => new Request(URL),
    invoke: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
})

const KEY = keyForRemoteCall('GET', '/rpc/streamWake', undefined)

function snapshot(body: string): CacheSnapshotEntry {
    return {
        key: KEY,
        url: URL,
        method: 'GET',
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/json']],
        body,
    }
}

describe('seedStreamedResolution wakes a subscribed peek (ADR-0024 D3)', () => {
    beforeEach(() => {
        cacheStoreSlot.resolver = () => cacheStoreSlot.fallback
        cacheStoreSlot.fallback = createCacheStore()
        hydrationWindow.active = false
    })
    afterEach(() => {
        cacheStoreSlot.resolver = undefined
        cacheStoreSlot.fallback = undefined
        hydrationWindow.active = false
    })

    test('a streamed resolution re-runs the peek scope and surfaces the value', async () => {
        let runs = 0
        let seen: { id: string } | undefined = { id: 'INIT' }
        /* The peek subscribes the key + taps its lifecycle channel (like the compiled bare-read
           throwing peek). It reads undefined at first — nothing retained. */
        const dispose = effect(() => {
            runs += 1
            seen = peek(getUser)
        })
        expect(runs).toBe(1)
        expect(seen).toBeUndefined()

        /* The streamed frame arrives (the `__abideResolve` counterpart): seed + wake. */
        seedStreamedResolution(snapshot(JSON.stringify({ id: '7' })))
        await settle()

        expect(runs).toBeGreaterThan(1) // the wake re-ran the scope
        expect(seen).toEqual({ id: '7' }) // and it now sees the streamed value
        dispose()
    })

    test('a miss marker seeds nothing and does not disturb a subscribed peek', async () => {
        let runs = 0
        const dispose = effect(() => {
            runs += 1
            peek(getUser)
        })
        expect(runs).toBe(1)
        /* A `{ key, miss }` marker is a no-op seed (the client refetches live), so it must not
           fire a spurious wake that would re-render to the same undefined. */
        seedStreamedResolution({ key: KEY, miss: true })
        await settle()
        expect(runs).toBe(1)
        dispose()
    })
})
