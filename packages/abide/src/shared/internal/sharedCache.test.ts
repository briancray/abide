// PR1 — server SHARED cross-request cache + fail-closed purity (rpc-core §2, shared-cache-plan §2.1).
//
// Storage + the two fail-closed checkpoints, no transport. These run "server-side" (the bunfig
// preload deletes global `window`) so the memo's shared branch is active.

import { afterEach, describe, expect, test } from 'bun:test'
import { context } from '../../server/context.ts'
import { cookies } from '../../server/cookies.ts'
import { GET } from '../../server/GET.ts'
import {
    anonymousPrincipal,
    type RequestScope,
    runInScope,
} from '../../server/internal/requestScope.ts'
import { request } from '../../server/request.ts'
import { identity } from '../identity.ts'
import { memo } from '../memo.ts'
import {
    sharedCacheAccount,
    sharedCachePin,
    sharedCacheSettleStream,
    sharedStore,
} from './sharedCache.ts'

function makeScope(overrides?: Partial<RequestScope>): RequestScope {
    const url = new URL('http://localhost/test')
    return {
        request: new Request(url),
        cookies: new Bun.CookieMap(),
        identity: anonymousPrincipal(),
        bag: {},
        route: { kind: 'rpc', name: 'test', params: {}, url, navigating: false },
        slots: new Map<string, unknown>(),
        ...overrides,
    }
}

// Whether any slot in the shared store currently holds a settled `value` (used to prove that a
// fail-closed handler's value was NEVER cached — an error slot has no value).
function hasCachedValue(): boolean {
    for (const entry of sharedStore().values()) {
        const status = (entry as { state: { peek(): { status: string } } }).state.peek().status
        if (status === 'value') return true
    }
    return false
}

afterEach(() => {
    // The shared store is process-global; keep tests isolated.
    sharedStore().clear()
    delete Bun.env.ABIDE_MAX_SHARED_CACHE_SIZE
})

describe('shared store — cross-request memoization', () => {
    test('a shared read runs its handler ONCE across two distinct requests', async () => {
        let calls = 0
        const c = memo(
            async (n: number) => {
                calls++
                return n * 2
            },
            { crossRequest: true },
        )

        const first = await runInScope(
            makeScope({ identity: { id: 'user-A', authenticated: true } }),
            () => c(5),
        )
        const second = await runInScope(
            makeScope({ identity: { id: 'user-B', authenticated: true } }),
            () => c(5),
        )

        expect(first).toBe(10)
        expect(second).toBe(10)
        expect(calls).toBe(1) // second request served from the cross-request store
    })

    // `crossRequest` no longer forces the classic promise path: a SYNCHRONOUS body keyed by its args is
    // pure over them — precisely the condition the shared store already requires — so it stores its slot
    // there while its read stays `T`. The store is an in-memory Map, so a hit is synchronous too.
    test('a KEYED SYNC handler shares one run across requests and still reads as T', () => {
        let calls = 0
        const c = memo(
            ({ n }: { n: number }) => {
                calls++
                return n * 2
            },
            { crossRequest: true },
        )

        const first = runInScope(
            makeScope({ identity: { id: 'user-A', authenticated: true } }),
            () => c({ n: 5 }),
        )
        const second = runInScope(
            makeScope({ identity: { id: 'user-B', authenticated: true } }),
            () => c({ n: 5 }),
        )

        expect(first).toBe(10)
        expect(first).not.toBeInstanceOf(Promise)
        expect(second).toBe(10)
        expect(calls).toBe(1)
    })

    // The auto-tracked path reaches the shared store through the same `slots()` routing. Its backing
    // computed rides the slot, so it must NOT be torn down when the request that built it ends —
    // the next request would otherwise find a live slot holding a disposed computed.
    test('an ARGLESS auto-tracked crossRequest memo survives the request that built it', () => {
        let calls = 0
        const c = memo(
            () => {
                calls++
                return 21 * 2
            },
            { crossRequest: true },
        )

        const first = runInScope(makeScope(), () => c())
        const second = runInScope(makeScope(), () => c())

        expect(first).toBe(42)
        expect(second).toBe(42)
        expect(calls).toBe(1)
    })
})

describe('fail-closed checkpoint (a) — handler isolation', () => {
    // The accessors throw UNCONDITIONALLY (no NODE_ENV branch), so the guarantee holds in prod too.
    for (const nodeEnv of [undefined, 'production'] as const) {
        test(`a shared handler calling identity() rejects and NEVER caches (NODE_ENV=${nodeEnv ?? 'unset'})`, async () => {
            const original = Bun.env.NODE_ENV
            if (nodeEnv === undefined) delete Bun.env.NODE_ENV
            else Bun.env.NODE_ENV = nodeEnv
            try {
                const c = memo(
                    async (_n: number) => {
                        // Touching request scope from a shared (scope-exited) handler must throw.
                        return `secret-for-${identity().id}`
                    },
                    { crossRequest: true },
                )

                const promise = runInScope(
                    makeScope({ identity: { id: 'user-A', authenticated: true } }),
                    () => c(1),
                )
                await expect(promise).rejects.toThrow(/no active request scope/)

                // The would-be value is NOT in the shared store (only an error slot remains).
                expect(hasCachedValue()).toBe(false)
            } finally {
                if (original === undefined) delete Bun.env.NODE_ENV
                else Bun.env.NODE_ENV = original
            }
        })
    }

    test('a shared handler calling request() also rejects and does not cache', async () => {
        const c = memo(async (_n: number) => request().url, { crossRequest: true })
        const promise = runInScope(makeScope(), () => c(2))
        await expect(promise).rejects.toThrow(/no active request scope/)
        expect(hasCachedValue()).toBe(false)
    })

    test('a shared handler that is pure over its args caches and serves from the shared store', async () => {
        const c = memo(async (n: number) => n + 100, { crossRequest: true })
        const value = await runInScope(makeScope(), () => c(7))
        expect(value).toBe(107)
        expect(hasCachedValue()).toBe(true)
    })
})

// CHECKPOINT (a) ACROSS ALL THREE FILL MODES. `CLAUDE.md` promises the strong form — "a crossRequest
// body runs scope-exited on EVERY path" — and a slot has three ways to fill: the loading path, a KEYED
// SYNC body (`memo(({n}) => …)`, which is what every `GET(({n}) => …, { memo: { crossRequest: true } })`
// produces), and an argless AUTO-TRACKED derivation.
//
// Every other fail-closed test in this file uses an `async` body, so it exercises the loading path and
// only the loading path. The rule was written out once per path, and two of the three statements were
// unguarded — a refactor of either sync path was one deletion away from caching a per-user value in the
// process-global store, with nothing in any VALUE to show it. The rule has one statement now
// (`runFillBody`); this is the matrix that holds it to all three.
//
// The two sync modes fail SYNCHRONOUSLY rather than as a rejected promise, which is the point of asking
// each mode in its own terms: `rejects.toThrow` would pass vacuously on a body that never returns one.
describe('fail-closed checkpoint (a) — every fill mode, not just the loading path', () => {
    test('a KEYED SYNC body cannot read request scope, and caches nothing', () => {
        const c = memo(({ n }: { n: number }) => `secret-for-${identity().id}-${n}`, {
            crossRequest: true,
        })
        expect(() =>
            runInScope(makeScope({ identity: { id: 'user-A', authenticated: true } }), () =>
                c({ n: 1 }),
            ),
        ).toThrow(/no active request scope/)
        expect(hasCachedValue()).toBe(false)
    })

    test('an AUTO-TRACKED body cannot read request scope, and caches nothing', () => {
        const c = memo(() => `secret-for-${identity().id}`, { crossRequest: true })
        expect(() =>
            runInScope(makeScope({ identity: { id: 'user-B', authenticated: true } }), () => c()),
        ).toThrow(/no active request scope/)
        expect(hasCachedValue()).toBe(false)
    })

    // The full accessor set, on the two modes that had no coverage at all. One shared slot per accessor
    // per mode, so a mode that leaked only `cookies()` (say) is still visible.
    for (const [name, read] of [
        ['identity', () => identity().id],
        ['request', () => request().url],
        ['cookies', () => JSON.stringify(cookies().toJSON())],
        ['context', () => Object.keys(context()).join(',')],
    ] as const) {
        test(`keyed sync + auto-tracked both throw on ${name}()`, () => {
            const keyed = memo(({ n }: { n: number }) => `${read()}${n}`, { crossRequest: true })
            const auto = memo(() => read(), { crossRequest: true })
            expect(() => runInScope(makeScope(), () => keyed({ n: 1 }))).toThrow(
                /no active request scope/,
            )
            expect(() => runInScope(makeScope(), () => auto())).toThrow(/no active request scope/)
            expect(hasCachedValue()).toBe(false)
        })
    }

    // The positive half: a body that is pure over its args still caches on the sync paths, so the
    // isolation is not being achieved by breaking them.
    test('a pure KEYED SYNC body caches and serves from the shared store', () => {
        let runs = 0
        const c = memo(
            ({ n }: { n: number }) => {
                runs++
                return n + 100
            },
            { crossRequest: true },
        )
        expect(runInScope(makeScope(), () => c({ n: 7 }))).toBe(107)
        expect(runInScope(makeScope(), () => c({ n: 7 }))).toBe(107)
        expect(runs).toBe(1)
        expect(hasCachedValue()).toBe(true)
    })
})

// ADR 0026 gate. The fail-closed guarantee is about to stop being maintained by entering and exiting
// the scope ALS and the reactive scope in lockstep, and start resting on their SLOT-MAP IDENTITY. These
// cases pin the guarantee itself so the mechanism swap underneath cannot quietly weaken it: every
// request-scope accessor must throw from a shared handler, and a nested non-shared memo must never
// write into the request's Map.
describe('fail-closed checkpoint (a) — the full accessor matrix', () => {
    test('a shared handler calling cookies() rejects and does not cache', async () => {
        const c = memo(async (_n: number) => cookies().toJSON(), { crossRequest: true })
        await expect(runInScope(makeScope(), () => c(11))).rejects.toThrow(
            /no active request scope/,
        )
        expect(hasCachedValue()).toBe(false)
    })

    test('a shared handler calling context() rejects and does not cache', async () => {
        const c = memo(async (_n: number) => Object.keys(context()), { crossRequest: true })
        await expect(runInScope(makeScope(), () => c(12))).rejects.toThrow(
            /no active request scope/,
        )
        expect(hasCachedValue()).toBe(false)
    })

    test('a nested NON-shared memo inside a shared handler never writes the request Map', async () => {
        let innerCalls = 0
        const inner = memo(async (n: number) => {
            innerCalls++
            return n * 2
        })
        const outer = memo(async (n: number) => (await inner(n)) + 1, { crossRequest: true })

        const scope = makeScope()
        expect(await runInScope(scope, () => outer(21))).toBe(43)

        // The shared slot lives in the process-global store and the nested read was routed to the
        // neutral default context, so the REQUEST's own Map saw neither of them.
        expect(scope.slots.size).toBe(0)
        expect(innerCalls).toBe(1)
    })
})

// `crossRequest` means ONE SLOT FOR EVERY CALLER, wherever the call is made from. There is no
// ambient-entry guard: the read used to throw outside a request scope, which made a cron tick or an
// `abide run` migration unable to read a cache it was allowed to `refresh()`. Checkpoint (a) is what
// keeps the store safe — the body is scope-exited, so the value is identity-free by construction.
describe('a crossRequest memo is callable from ANY caller, request or not', () => {
    test('a shared read with no active request scope works', async () => {
        const c = memo(async (n: number) => n + 1, { crossRequest: true })
        expect(await c(1)).toBe(2)
        expect(c.live(1)).toBe(2)
    })

    test('a scriptless caller and a request share ONE slot in both directions', async () => {
        let calls = 0
        const c = memo(
            async (n: number) => {
                calls++
                return n * 2
            },
            { crossRequest: true },
        )

        // Bare (cron/script) caller fills the slot; the request reads the same one.
        expect(await c(5)).toBe(10)
        expect(await runInScope(makeScope(), () => c(5))).toBe(10)
        expect(calls).toBe(1)

        // And the reverse: a request fills, a bare caller reads.
        expect(await runInScope(makeScope(), () => c(6))).toBe(12)
        expect(await c(6)).toBe(12)
        expect(calls).toBe(2)
    })

    test('a bare caller can invalidate what a request cached, and re-fill it', async () => {
        let calls = 0
        const c = memo(
            async (n: number) => {
                calls++
                return n + calls
            },
            { crossRequest: true },
        )

        expect(await runInScope(makeScope(), () => c(1))).toBe(2)
        c.invalidate(1)
        expect(await c(1)).toBe(3)
        expect(calls).toBe(2)
    })

    test('checkpoint (a) still holds for a bare caller — the body cannot read request scope', async () => {
        const c = memo(async (_n: number) => identity().id, { crossRequest: true })
        await expect(c(1)).rejects.toThrow(/no active request scope/)
        expect(hasCachedValue()).toBe(false)
    })

    // The operational shape the option exists for: a cron tick / `abide run` migration warming a
    // crossRequest rpc in-process, which every later request then serves from. Covered at the RPC
    // surface and not only at the memo, because `makeRpc` is where a caller-side gate would sit.
    test('a crossRequest RPC is callable in-process with no request scope', async () => {
        let calls = 0
        const read = GET(
            ({ n = 0 }) => {
                calls++
                return { n: n * 2 }
            },
            { memo: { crossRequest: true } },
        )

        expect(await read({ n: 4 })).toEqual({ n: 8 })
        expect(await runInScope(makeScope(), () => read({ n: 4 }))).toEqual({ n: 8 })
        expect(calls).toBe(1)
        expect(read.live({ n: 4 })).toEqual({ n: 8 })

        // And the write verbs reach the same slot they always could.
        read.invalidate({ n: 4 })
        expect(await read({ n: 4 })).toEqual({ n: 8 })
        expect(calls).toBe(2)
    })
})

describe('non-shared memos are unaffected (per-context isolation preserved)', () => {
    test('an ordinary memo re-runs its handler per request scope', async () => {
        let calls = 0
        const c = memo(async (n: number) => {
            calls++
            return n * 3
        }) // no `shared`

        await runInScope(makeScope(), () => c(4))
        await runInScope(makeScope(), () => c(4))

        // Two separate per-request caches → the handler ran once per request.
        expect(calls).toBe(2)
        // Nothing leaked into the shared store.
        expect(sharedStore().size).toBe(0)
    })

    test('an ordinary memo works with no scope (bare script) — no ambient guard', async () => {
        const c = memo(async (n: number) => n + 1)
        expect(await c(9)).toBe(10)
    })
})

describe('LRU eviction by ABIDE_MAX_SHARED_CACHE_SIZE', () => {
    test('the least-recently-read slot is evicted when the byte ceiling overflows', async () => {
        // Each value is a 10-char string → ~12 JSON bytes ("xxxxxxxxxx" with quotes). Ceiling 30 bytes
        // holds ~2 slots; a 3rd load overflows and evicts the oldest.
        Bun.env.ABIDE_MAX_SHARED_CACHE_SIZE = '30'
        const c = memo(async (_n: number) => `${'v'.repeat(10)}`, {
            crossRequest: true,
            key: 'lru-memo',
        })

        await runInScope(makeScope(), () => c(1))
        await runInScope(makeScope(), () => c(2))
        // Touch slot 1 so it is most-recently-read; slot 2 becomes the eviction candidate.
        await runInScope(makeScope(), () => c(1))
        await runInScope(makeScope(), () => c(3))

        const keys = [...sharedStore().keys()]
        const present = (n: number) => keys.some((k) => k.endsWith(`n${n}`)) // canonicalKey(n) === "n"+n
        // Slot 2 (least-recently-read) evicted; slots 1 and 3 retained.
        expect(present(2)).toBe(false)
        expect(present(1)).toBe(true)
        expect(present(3)).toBe(true)
    })
})

// The two named TRANSITIONS (`sharedCacheAccount` / `sharedCacheSettleStream`), which replaced
// hand-driven verb sequences at six call sites in `memo.ts`.
//
// Both failure modes here are SILENT and invisible in a value — which is why they are asserted as
// state, not as a returned result:
//   • forget `evictIfNeeded` → the store quietly grows past its ceiling.
//   • forget `unpin` when a stream closes → the key is pinned forever, so it is never evictable again
//     AND its bytes keep counting against the ceiling, dragging every other entry down with it.
describe('the shared-cache transitions', () => {
    const LIMIT = 'ABIDE_MAX_SHARED_CACHE_SIZE'
    const originalLimit = Bun.env[LIMIT]

    afterEach(() => {
        if (originalLimit === undefined) delete Bun.env[LIMIT]
        else Bun.env[LIMIT] = originalLimit
    })

    test('account() records a size AND trims to the ceiling in one step', () => {
        Bun.env[LIMIT] = '100'
        const store = new Map<string, unknown>()
        store.set('a', 'first')
        sharedCacheAccount(store, 'a', 80)
        expect(store.has('a')).toBe(true)

        store.set('b', 'second')
        sharedCacheAccount(store, 'b', 80) // 160 > 100 → the LRU entry goes
        expect(store.has('b')).toBe(true)
        expect(store.has('a')).toBe(false)
    })

    test('account() does NOT unpin — an open stream must stay pinned through its growth', () => {
        Bun.env[LIMIT] = '50'
        const store = new Map<string, unknown>()
        store.set('open', 'streaming')
        sharedCachePin(store, 'open')
        sharedCacheAccount(store, 'open', 500) // way over the ceiling
        // Pinned entries are deliberately not evictable: a replay in progress must survive.
        expect(store.has('open')).toBe(true)
    })

    test('settleStream() unpins, so a CLOSED stream becomes evictable again', () => {
        Bun.env[LIMIT] = '50'
        const store = new Map<string, unknown>()
        store.set('closed', 'transcript')
        sharedCachePin(store, 'closed')
        // While pinned and over the ceiling it survives...
        sharedCacheAccount(store, 'closed', 500)
        expect(store.has('closed')).toBe(true)
        // ...and once settled it is an ordinary sized entry, so the ceiling reaches it.
        sharedCacheSettleStream(store, 'closed', 500)
        expect(store.has('closed')).toBe(false)
    })

    test('both are a no-op when there is no shared store (a non-crossRequest memo)', () => {
        expect(() => sharedCacheAccount(undefined, 'k', 1)).not.toThrow()
        expect(() => sharedCacheSettleStream(undefined, 'k', 1)).not.toThrow()
    })
})
