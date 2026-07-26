// PR1 — server SHARED cross-request cache + fail-closed purity (rpc-core §2, shared-cache-plan §2.1).
//
// Storage + the two fail-closed checkpoints, no transport. These run "server-side" (the bunfig
// preload deletes global `window`) so the memo's shared branch is active.

import { afterEach, describe, expect, test } from 'bun:test'
import { context } from '../../server/context.ts'
import { cookies } from '../../server/cookies.ts'
import { identity } from '../../server/identity.ts'
import { anonymousPrincipal, type RequestScope, runInScope } from '../../server/internal/scope.ts'
import { request } from '../../server/request.ts'
import { memo } from '../memo.ts'
import { sharedStore } from './sharedCache.ts'

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
            { shared: true },
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
                    { shared: true },
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
        const c = memo(async (_n: number) => request().url, { shared: true })
        const promise = runInScope(makeScope(), () => c(2))
        await expect(promise).rejects.toThrow(/no active request scope/)
        expect(hasCachedValue()).toBe(false)
    })

    test('a shared handler that is pure over its args caches and serves from the shared store', async () => {
        const c = memo(async (n: number) => n + 100, { shared: true })
        const value = await runInScope(makeScope(), () => c(7))
        expect(value).toBe(107)
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
        const c = memo(async (_n: number) => cookies().toJSON(), { shared: true })
        await expect(runInScope(makeScope(), () => c(11))).rejects.toThrow(
            /no active request scope/,
        )
        expect(hasCachedValue()).toBe(false)
    })

    test('a shared handler calling context() rejects and does not cache', async () => {
        const c = memo(async (_n: number) => Object.keys(context()), { shared: true })
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
        const outer = memo(async (n: number) => (await inner(n)) + 1, { shared: true })

        const scope = makeScope()
        expect(await runInScope(scope, () => outer(21))).toBe(43)

        // The shared slot lives in the process-global store and the nested read was routed to the
        // neutral default context, so the REQUEST's own Map saw neither of them.
        expect(scope.slots.size).toBe(0)
        expect(innerCalls).toBe(1)
    })
})

describe('fail-closed checkpoint (b) — ambient-entry guard', () => {
    test('a shared read with no active request scope throws a clear error', () => {
        const c = memo(async (n: number) => n, { shared: true })
        // The guard runs at the read entry (synchronously) on both the reactive peek and load paths.
        expect(() => c(1)).toThrow('shared memo read requires an active request scope')
        expect(() => c(1)).toThrow('shared memo read requires an active request scope')
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
        const c = memo(async (_n: number) => `${'v'.repeat(10)}`, { shared: true, key: 'lru-memo' })

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
