// PR4 — cache TAGS: the global `invalidate/refresh({ tags })` selectors + per-tag channel
// (rpc-core §8, shared-cache-plan §2.4). These run "server-side" (the bunfig preload deletes global
// `window`) so the memo's shared/tag branch is active.

import { afterEach, describe, expect, test } from 'bun:test'
import {
    type MemoFrame,
    memoChannelHub,
    memoChannelName,
    publishMemoFrame,
    tagChannelName,
} from '../../shared/internal/memoChannels.ts'
import { clearTagRegistry, taggedMemoCount } from '../../shared/internal/memoTags.ts'
import { disposeScope } from '../../shared/internal/reactiveScope.ts'
import { sharedStore } from '../../shared/internal/sharedCache.ts'
import { invalidate } from '../../shared/invalidate.ts'
import { memo } from '../../shared/memo.ts'
import { pending } from '../../shared/pending.ts'
import { refresh } from '../../shared/refresh.ts'
import { refreshing } from '../../shared/refreshing.ts'
import { until } from '../../test/internal/until.ts'
import { makeRead, type Rpc } from './makeRpc.ts'
import { anonymousPrincipal, type RequestScope, runInScope } from './requestScope.ts'

function makeScope(name: string): RequestScope {
    const request = new Request(`http://localhost/rpc/${name}`)
    return {
        request,
        cookies: new Bun.CookieMap(''),
        identity: anonymousPrincipal(),
        bag: {},
        route: { kind: 'rpc', name, params: {}, url: new URL(request.url), navigating: false },
        slots: new Map<string, unknown>(),
    }
}

// The channel publish closure createApp binds — replicated so tests bind a bare route (identical to
// router.createApp / memoChannels.test.ts).
function bindLikeCreateApp<Args, T>(route: Rpc<Args, T>, name: string): void {
    route.bindBroadcast((verb, args, value): void => {
        const frame: MemoFrame = verb === 'publish' ? { verb, value } : { verb }
        publishMemoFrame(memoChannelName(name, args), frame)
    })
}

const TIMEOUT = Symbol('timeout')
async function nextOrTimeout(
    iterator: AsyncIterator<MemoFrame>,
    ms: number,
): Promise<MemoFrame | typeof TIMEOUT> {
    const timeout = new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms))
    const next = iterator.next().then((result) => result.value as MemoFrame)
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
            { memo: { crossRequest: true, tags: ['user'] } },
        )
        const readY = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                callsY++
                return { id, v: 'y' }
            },
            { memo: { crossRequest: true, tags: ['user'] } },
        )
        bindLikeCreateApp(readX, 'readX')
        bindLikeCreateApp(readY, 'readY')

        // Seed one slot in each, through the request path a browser read would take.
        await runInScope(makeScope('readX'), () => readX({ id: 1 }))
        await runInScope(makeScope('readY'), () => readY({ id: 1 }))
        expect(callsX).toBe(1)
        expect(callsY).toBe(1)

        const iterX = memoChannelHub(memoChannelName('readX', { id: 1 })).subscribe()
        const iterY = memoChannelHub(memoChannelName('readY', { id: 1 })).subscribe()

        invalidate({ tags: ['user'] })

        expect((await iterX.next()).value).toEqual({ verb: 'invalidate' })
        expect((await iterY.next()).value).toEqual({ verb: 'invalidate' })
        await iterX.return?.()
        await iterY.return?.()

        // Slots were dropped → next read re-runs the handler.
        await runInScope(makeScope('readX'), () => readX({ id: 1 }))
        await runInScope(makeScope('readY'), () => readY({ id: 1 }))
        expect(callsX).toBe(2)
        expect(callsY).toBe(2)
    })

    test("a memo tagged 'a' is NOT affected by invalidate({ tags: ['b'] })", async () => {
        let calls = 0
        const read = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                calls++
                return id
            },
            { memo: { crossRequest: true, tags: ['a'] } },
        )
        bindLikeCreateApp(read, 'readA')

        await runInScope(makeScope('readA'), () => read({ id: 1 }))
        expect(calls).toBe(1)

        const iter = memoChannelHub(memoChannelName('readA', { id: 1 })).subscribe()
        invalidate({ tags: ['b'] })
        expect(await nextOrTimeout(iter, 25)).toBe(TIMEOUT) // no broadcast
        await iter.return?.()

        // Slot survived → served from cache, handler not re-run.
        await runInScope(makeScope('readA'), () => read({ id: 1 }))
        expect(calls).toBe(1)
    })

    test('multiple tags on one memo — a partial tag match still selects it', async () => {
        let calls = 0
        const read = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                calls++
                return id
            },
            { memo: { crossRequest: true, tags: ['user', 'org'] } },
        )
        bindLikeCreateApp(read, 'readMulti')

        await runInScope(makeScope('readMulti'), () => read({ id: 1 }))
        expect(calls).toBe(1)

        const iter = memoChannelHub(memoChannelName('readMulti', { id: 1 })).subscribe()
        invalidate({ tags: ['org'] }) // only one of the two tags
        expect((await iter.next()).value).toEqual({ verb: 'invalidate' })
        await iter.return?.()

        await runInScope(makeScope('readMulti'), () => read({ id: 1 }))
        expect(calls).toBe(2)
    })

    test('selects each memo once even when it carries several listed tags', async () => {
        const read = makeRead('GET', async ({ id }: { id: number }) => id, {
            memo: { crossRequest: true, tags: ['a', 'b'] },
        })
        bindLikeCreateApp(read, 'readDedup')
        await runInScope(makeScope('readDedup'), () => read({ id: 1 }))

        const iter = memoChannelHub(memoChannelName('readDedup', { id: 1 })).subscribe()
        invalidate({ tags: ['a', 'b'] })
        expect((await iter.next()).value).toEqual({ verb: 'invalidate' })
        // Exactly ONE frame — the memo is not touched once per matching tag.
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
            { memo: { crossRequest: true, tags: ['user'] } },
        )
        bindLikeCreateApp(read, 'readR')

        await runInScope(makeScope('readR'), () => read({ id: 1 }))
        expect(calls).toBe(1)

        const iter = memoChannelHub(memoChannelName('readR', { id: 1 })).subscribe()
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
            memo: { crossRequest: true, tags: ['user'] },
        })
        bindLikeCreateApp(read, 'readTagChan')
        await runInScope(makeScope('readTagChan'), () => read({ id: 1 }))

        const tagIter = memoChannelHub(tagChannelName('user')).subscribe()
        invalidate({ tags: ['user'] })
        expect((await tagIter.next()).value).toEqual({ verb: 'invalidate' })
        await tagIter.return?.()
    })

    test('refresh({ tags }) emits a refresh frame on the @tag channel even with no registered memos', async () => {
        const tagIter = memoChannelHub(tagChannelName('ghost')).subscribe()
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
            { memo: { crossRequest: true, tags: ['user'] } },
        )
        bindLikeCreateApp(read, 'readProbe')

        // No slots yet → nothing pending/refreshing.
        expect(pending({ tags: ['user'] })).toBe(false)
        expect(refreshing({ tags: ['user'] })).toBe(false)

        // Kick a load (do not await): the slot is on its first load → pending true.
        const load = runInScope(makeScope('readProbe'), () => read({ id: 1 }))
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

// Tags used to be discarded off `crossRequest` (`memo.ts`), which made them dead in the browser: a
// client memo is never `crossRequest`, so `refresh({ tags })` there matched an empty registry and did
// nothing at all. These exercise the plain (non-crossRequest) memo — the ONLY kind a browser builds.
describe('cache tags — isomorphic (no crossRequest)', () => {
    test('invalidate({ tags }) drops a plain memo’s slots; the next read re-runs', async () => {
        let calls = 0
        const read = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                calls++
                return { id }
            },
            { memo: { tags: ['plain'] } },
        )

        await runInScope(makeScope('plainRead'), async () => {
            await read({ id: 1 })
            expect(calls).toBe(1)
            await read({ id: 1 })
            expect(calls).toBe(1) // memoized

            invalidate({ tags: ['plain'] })
            await read({ id: 1 })
            expect(calls).toBe(2)
        })
    })

    test('refresh({ tags }) eagerly re-runs a plain memo without a request scope', async () => {
        let calls = 0
        const derived = memo(
            async () => {
                calls++
                return calls
            },
            { tags: ['bare'] },
        )

        expect(await derived()).toBe(1)
        refresh({ tags: ['bare'] })
        await until('the tag refresh re-ran the memo', () => calls === 2)
        expect(calls).toBe(2) // eager, no scope needed — nothing here is server machinery
    })

    test('a tag verb reaches every memo carrying the tag, crossRequest or not', async () => {
        let plainCalls = 0
        const plain = memo(
            async () => {
                plainCalls++
                return plainCalls
            },
            { tags: ['mixed'] },
        )
        let sharedCalls = 0
        const shared = makeRead(
            'GET',
            async ({ id }: { id: number }) => {
                sharedCalls++
                return { id }
            },
            { memo: { crossRequest: true, tags: ['mixed'] } },
        )
        bindLikeCreateApp(shared, 'mixedRead')

        await plain()
        await runInScope(makeScope('mixedRead'), () => shared({ id: 1 }))
        expect(plainCalls).toBe(1)
        expect(sharedCalls).toBe(1)

        refresh({ tags: ['mixed'] })
        await until('both tagged memos re-ran', () => plainCalls === 2 && sharedCalls === 2)
        expect(plainCalls).toBe(2)
        expect(sharedCalls).toBe(2)
    })
})

// The registry is process-global with no eviction, so registration had to become disposable before the
// `crossRequest` gate could come off: a tagged memo built per component instance would otherwise pin
// itself (and closures over its whole slot map) forever.
describe('cache tags — registration lifetime', () => {
    // Asserted against the REGISTRY, not against re-runs: a disposed memo's slots die with its scope
    // regardless, so "refresh() no longer re-runs it" passes even with the unregister deleted. The
    // registry entry is the thing that would actually accumulate.
    test('a memo built inside a request scope unregisters when the scope disposes', async () => {
        const scope = makeScope('scoped')
        await runInScope(scope, async () => {
            const scoped = memo(async () => 1, { tags: ['scoped'] })
            await scoped()
            expect(taggedMemoCount('scoped')).toBe(1)
        })

        disposeScope(scope)
        expect(taggedMemoCount('scoped')).toBe(0)
    })

    test('repeated scoped construction does not accumulate registrations', async () => {
        for (let i = 0; i < 5; i++) {
            const scope = makeScope('churn')
            await runInScope(scope, async () => {
                const scoped = memo(async () => i, { tags: ['churn'] })
                await scoped()
            })
            disposeScope(scope)
        }
        expect(taggedMemoCount('churn')).toBe(0)
    })

    // The counterpart: a module-level memo (every rpc client proxy, every crossRequest server memo) is
    // owned by nothing that disposes, so it stays registered for as long as it exists.
    test('a memo built outside any scope stays registered', async () => {
        const forever = memo(async () => 1, { tags: ['forever'] })
        await forever()
        expect(taggedMemoCount('forever')).toBe(1)
    })
})
