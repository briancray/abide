// PR1 — server SHARED cross-request cache + fail-closed purity (rpc-core §2, shared-cache-plan §2.1).
//
// Storage + the two fail-closed checkpoints, no transport. These run "server-side" (the bunfig
// preload deletes global `window`) so the cell's shared branch is active.

import { afterEach, describe, expect, test } from 'bun:test'
import { identity } from '../../server/identity.ts'
import { anonymousPrincipal, type RequestScope, runInScope } from '../../server/internal/scope.ts'
import { request } from '../../server/request.ts'
import { cell } from '../cell.ts'
import { sharedStore } from './sharedCache.ts'

function makeScope(overrides?: Partial<RequestScope>): RequestScope {
    const url = new URL('http://localhost/test')
    return {
        request: new Request(url),
        cookies: new Bun.CookieMap(),
        identity: anonymousPrincipal(),
        bag: {},
        route: { kind: 'rpc', name: 'test', params: {}, url, navigating: false },
        cache: new Map<string, unknown>(),
        ...overrides,
    }
}

// Whether any slot in the shared store currently holds a settled `value` (used to prove that a
// fail-closed handler's value was NEVER cached — an error slot has no value).
function hasCachedValue(): boolean {
    for (const entry of sharedStore().values()) {
        const status = (entry as { signal: { peek(): { status: string } } }).signal.peek().status
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
        const c = cell(
            async (n: number) => {
                calls++
                return n * 2
            },
            { shared: true },
        )

        const first = await runInScope(
            makeScope({ identity: { id: 'user-A', authenticated: true } }),
            () => c.load(5),
        )
        const second = await runInScope(
            makeScope({ identity: { id: 'user-B', authenticated: true } }),
            () => c.load(5),
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
                const c = cell(
                    async (_n: number) => {
                        // Touching request scope from a shared (scope-exited) handler must throw.
                        return `secret-for-${identity().id}`
                    },
                    { shared: true },
                )

                const promise = runInScope(
                    makeScope({ identity: { id: 'user-A', authenticated: true } }),
                    () => c.load(1),
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
        const c = cell(async (_n: number) => request().url, { shared: true })
        const promise = runInScope(makeScope(), () => c.load(2))
        await expect(promise).rejects.toThrow(/no active request scope/)
        expect(hasCachedValue()).toBe(false)
    })

    test('a shared handler that is pure over its args caches and serves from the shared store', async () => {
        const c = cell(async (n: number) => n + 100, { shared: true })
        const value = await runInScope(makeScope(), () => c.load(7))
        expect(value).toBe(107)
        expect(hasCachedValue()).toBe(true)
    })
})

describe('fail-closed checkpoint (b) — ambient-entry guard', () => {
    test('a shared read with no active request scope throws a clear error', () => {
        const c = cell(async (n: number) => n, { shared: true })
        // The guard runs at the read entry (synchronously) on both the reactive peek and load paths.
        expect(() => c(1)).toThrow('shared cell read requires an active request scope')
        expect(() => c.load(1)).toThrow('shared cell read requires an active request scope')
    })
})

describe('non-shared cells are unaffected (per-context isolation preserved)', () => {
    test('an ordinary cell re-runs its handler per request scope', async () => {
        let calls = 0
        const c = cell(async (n: number) => {
            calls++
            return n * 3
        }) // no `shared`

        await runInScope(makeScope(), () => c.load(4))
        await runInScope(makeScope(), () => c.load(4))

        // Two separate per-request caches → the handler ran once per request.
        expect(calls).toBe(2)
        // Nothing leaked into the shared store.
        expect(sharedStore().size).toBe(0)
    })

    test('an ordinary cell works with no scope (bare script) — no ambient guard', async () => {
        const c = cell(async (n: number) => n + 1)
        expect(await c.load(9)).toBe(10)
    })
})

describe('LRU eviction by ABIDE_MAX_SHARED_CACHE_SIZE', () => {
    test('the least-recently-read slot is evicted when the byte ceiling overflows', async () => {
        // Each value is a 10-char string → ~12 JSON bytes ("xxxxxxxxxx" with quotes). Ceiling 30 bytes
        // holds ~2 slots; a 3rd load overflows and evicts the oldest.
        Bun.env.ABIDE_MAX_SHARED_CACHE_SIZE = '30'
        const c = cell(async (_n: number) => `${'v'.repeat(10)}`, { shared: true, key: 'lru-cell' })

        await runInScope(makeScope(), () => c.load(1))
        await runInScope(makeScope(), () => c.load(2))
        // Touch slot 1 so it is most-recently-read; slot 2 becomes the eviction candidate.
        await runInScope(makeScope(), () => c.load(1))
        await runInScope(makeScope(), () => c.load(3))

        const keys = [...sharedStore().keys()]
        const present = (n: number) => keys.some((k) => k.endsWith(`n${n}`)) // canonicalKey(n) === "n"+n
        // Slot 2 (least-recently-read) evicted; slots 1 and 3 retained.
        expect(present(2)).toBe(false)
        expect(present(1)).toBe(true)
        expect(present(3)).toBe(true)
    })
})
