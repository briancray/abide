// PR4 — cache TAGS: the global `invalidate/refresh({ tags })` selectors + per-tag channel
// (rpc-core §8, shared-cache-plan §2.4). These run "server-side" (the bunfig preload deletes global
// `window`) so the cell's shared/tag branch is active.

import { afterEach, describe, expect, test } from 'bun:test'
import { sharedStore } from '../../shared/internal/sharedCache.ts'
import { invalidate } from '../../shared/invalidate.ts'
import { pending } from '../../shared/pending.ts'
import { refresh } from '../../shared/refresh.ts'
import { refreshing } from '../../shared/refreshing.ts'
import {
    type CacheFrame,
    cacheChannelHub,
    cacheChannelName,
    publishCacheFrame,
    tagChannelName,
} from './cacheChannels.ts'
import { clearTagRegistry } from './cacheTags.ts'
import { makeRead, type Rpc } from './makeRpc.ts'
import { anonymousPrincipal, type RequestScope, runInScope } from './scope.ts'

function makeScope(name: string): RequestScope {
    const request = new Request(`http://localhost/rpc/${name}`)
    return {
        request,
        cookies: new Bun.CookieMap(''),
        identity: anonymousPrincipal(),
        bag: {},
        route: { kind: 'rpc', name, params: {}, url: new URL(request.url), navigating: false },
        cache: new Map<string, unknown>(),
    }
}

// The channel publish closure createApp binds — replicated so tests bind a bare route (identical to
// router.createApp / cacheChannels.test.ts).
function bindLikeCreateApp<Args, T>(route: Rpc<Args, T>, name: string): void {
    route.bindBroadcast((verb, args, value): void => {
        const frame: CacheFrame = verb === 'amend' ? { verb, value } : { verb }
        publishCacheFrame(cacheChannelName(name, args), frame)
    })
}

const TIMEOUT = Symbol('timeout')
async function nextOrTimeout(
    iterator: AsyncIterator<CacheFrame>,
    ms: number,
): Promise<CacheFrame | typeof TIMEOUT> {
    const timeout = new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms))
    const next = iterator.next().then((result) => result.value as CacheFrame)
    return Promise.race([next, timeout])
}

afterEach(() => {
    sharedStore().clear()
    clearTagRegistry()
})

describe('cache tags — global invalidate({ tags })', () => {
    test('drops the slots of every shared read carrying the tag and broadcasts on each @rpc: channel', async () => {
        let callsX = 0
        let callsY = 0
        const readX = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                callsX++
                return { id, v: 'x' }
            },
            { cache: { shared: true, tags: ['user'] } },
        )
        const readY = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                callsY++
                return { id, v: 'y' }
            },
            { cache: { shared: true, tags: ['user'] } },
        )
        bindLikeCreateApp(readX, 'readX')
        bindLikeCreateApp(readY, 'readY')

        // Seed one slot in each (shared reads require an active request scope).
        await runInScope(makeScope('readX'), () => readX.load({ id: 1 }))
        await runInScope(makeScope('readY'), () => readY.load({ id: 1 }))
        expect(callsX).toBe(1)
        expect(callsY).toBe(1)

        const iterX = cacheChannelHub(cacheChannelName('readX', { id: 1 })).subscribe()
        const iterY = cacheChannelHub(cacheChannelName('readY', { id: 1 })).subscribe()

        invalidate({ tags: ['user'] })

        expect((await iterX.next()).value).toEqual({ verb: 'invalidate' })
        expect((await iterY.next()).value).toEqual({ verb: 'invalidate' })
        await iterX.return?.()
        await iterY.return?.()

        // Slots were dropped → next read re-runs the handler.
        await runInScope(makeScope('readX'), () => readX.load({ id: 1 }))
        await runInScope(makeScope('readY'), () => readY.load({ id: 1 }))
        expect(callsX).toBe(2)
        expect(callsY).toBe(2)
    })

    test("a cell tagged 'a' is NOT affected by invalidate({ tags: ['b'] })", async () => {
        let calls = 0
        const read = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                calls++
                return id
            },
            { cache: { shared: true, tags: ['a'] } },
        )
        bindLikeCreateApp(read, 'readA')

        await runInScope(makeScope('readA'), () => read.load({ id: 1 }))
        expect(calls).toBe(1)

        const iter = cacheChannelHub(cacheChannelName('readA', { id: 1 })).subscribe()
        invalidate({ tags: ['b'] })
        expect(await nextOrTimeout(iter, 25)).toBe(TIMEOUT) // no broadcast
        await iter.return?.()

        // Slot survived → served from cache, handler not re-run.
        await runInScope(makeScope('readA'), () => read.load({ id: 1 }))
        expect(calls).toBe(1)
    })

    test('multiple tags on one cell — a partial tag match still selects it', async () => {
        let calls = 0
        const read = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                calls++
                return id
            },
            { cache: { shared: true, tags: ['user', 'org'] } },
        )
        bindLikeCreateApp(read, 'readMulti')

        await runInScope(makeScope('readMulti'), () => read.load({ id: 1 }))
        expect(calls).toBe(1)

        const iter = cacheChannelHub(cacheChannelName('readMulti', { id: 1 })).subscribe()
        invalidate({ tags: ['org'] }) // only one of the two tags
        expect((await iter.next()).value).toEqual({ verb: 'invalidate' })
        await iter.return?.()

        await runInScope(makeScope('readMulti'), () => read.load({ id: 1 }))
        expect(calls).toBe(2)
    })

    test('selects each cell once even when it carries several listed tags', async () => {
        const read = makeRead('GET', async ({ id }: { id: number }) => id, {
            cache: { shared: true, tags: ['a', 'b'] },
        })
        bindLikeCreateApp(read, 'readDedup')
        await runInScope(makeScope('readDedup'), () => read.load({ id: 1 }))

        const iter = cacheChannelHub(cacheChannelName('readDedup', { id: 1 })).subscribe()
        invalidate({ tags: ['a', 'b'] })
        expect((await iter.next()).value).toEqual({ verb: 'invalidate' })
        // Exactly ONE frame — the cell is not touched once per matching tag.
        expect(await nextOrTimeout(iter, 25)).toBe(TIMEOUT)
        await iter.return?.()
    })
})

describe('cache tags — global refresh({ tags })', () => {
    test('eagerly revalidates tagged slots and broadcasts refresh frames', async () => {
        let calls = 0
        const read = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                calls++
                return { id, calls }
            },
            { cache: { shared: true, tags: ['user'] } },
        )
        bindLikeCreateApp(read, 'readR')

        await runInScope(makeScope('readR'), () => read.load({ id: 1 }))
        expect(calls).toBe(1)

        const iter = cacheChannelHub(cacheChannelName('readR', { id: 1 })).subscribe()
        // refresh runs the handler outside the request scope (shared purity), so no active scope needed.
        refresh({ tags: ['user'] })
        expect((await iter.next()).value).toEqual({ verb: 'refresh' })
        await iter.return?.()

        // Give the eager reload a tick to settle.
        await new Promise((r) => setTimeout(r, 10))
        expect(calls).toBe(2)
    })
})

describe('cache tags — @tag channel', () => {
    test('invalidate({ tags }) emits a frame on the @tag:<tag> channel', async () => {
        const read = makeRead('GET', async ({ id }: { id: number }) => id, {
            cache: { shared: true, tags: ['user'] },
        })
        bindLikeCreateApp(read, 'readTagChan')
        await runInScope(makeScope('readTagChan'), () => read.load({ id: 1 }))

        const tagIter = cacheChannelHub(tagChannelName('user')).subscribe()
        invalidate({ tags: ['user'] })
        expect((await tagIter.next()).value).toEqual({ verb: 'invalidate' })
        await tagIter.return?.()
    })

    test('refresh({ tags }) emits a refresh frame on the @tag channel even with no registered cells', async () => {
        const tagIter = cacheChannelHub(tagChannelName('ghost')).subscribe()
        refresh({ tags: ['ghost'] })
        expect((await tagIter.next()).value).toEqual({ verb: 'refresh' })
        await tagIter.return?.()
    })
})

describe('cache tags — local reactive probes', () => {
    test('pending({ tags }) / refreshing({ tags }) aggregate over tagged slots', async () => {
        const read = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                await new Promise((r) => setTimeout(r, 20))
                return id
            },
            { cache: { shared: true, tags: ['user'] } },
        )
        bindLikeCreateApp(read, 'readProbe')

        // No slots yet → nothing pending/refreshing.
        expect(pending({ tags: ['user'] })).toBe(false)
        expect(refreshing({ tags: ['user'] })).toBe(false)

        // Kick a load (do not await): the slot is on its first load → pending true.
        const load = runInScope(makeScope('readProbe'), () => read.load({ id: 1 }))
        expect(pending({ tags: ['user'] })).toBe(true)
        expect(refreshing({ tags: ['user'] })).toBe(false)

        await load
        expect(pending({ tags: ['user'] })).toBe(false)
        expect(refreshing({ tags: ['user'] })).toBe(false)

        // refresh retains the value and flips refreshing on until the reload settles.
        refresh({ tags: ['user'] })
        expect(refreshing({ tags: ['user'] })).toBe(true)
        await new Promise((r) => setTimeout(r, 30))
        expect(refreshing({ tags: ['user'] })).toBe(false)
    })
})
