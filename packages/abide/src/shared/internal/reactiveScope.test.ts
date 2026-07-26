import { describe, expect, test } from 'bun:test'
import {
    createReactiveScope,
    enterScope,
    onScopeDispose,
    reactiveScope,
    releaseScope,
    retainScope,
} from './reactiveScope.ts'

describe('createReactiveScope', () => {
    test('returns a fresh context with an empty cache', () => {
        const ctx = createReactiveScope()
        expect(ctx.slots).toBeInstanceOf(Map)
        expect(ctx.slots.size).toBe(0)
    })

    test('each call is a distinct context with a distinct cache', () => {
        const a = createReactiveScope()
        const b = createReactiveScope()
        expect(a).not.toBe(b)
        expect(a.slots).not.toBe(b.slots)
        a.slots.set('x', 1)
        expect(b.slots.has('x')).toBe(false)
    })
})

describe('reactiveScope (no active context)', () => {
    test('returns a default context rather than throwing (bare script / cron)', () => {
        const ctx = reactiveScope()
        expect(ctx.slots).toBeInstanceOf(Map)
    })

    test('the default context is stable across calls (same instance)', () => {
        const first = reactiveScope()
        const second = reactiveScope()
        expect(first).toBe(second)
        expect(first.slots).toBe(second.slots)
    })

    test('the default context retains writes across calls', () => {
        reactiveScope().slots.set('persisted', 42)
        expect(reactiveScope().slots.get('persisted')).toBe(42)
    })
})

describe('enterScope isolation', () => {
    test('reactiveScope inside enterScope returns the supplied context', () => {
        const ctx = createReactiveScope()
        const seen = enterScope(ctx, () => reactiveScope())
        expect(seen).toBe(ctx)
        expect(seen.slots).toBe(ctx.slots)
    })

    test('two enterScope calls get separate caches', () => {
        const a = createReactiveScope()
        const b = createReactiveScope()
        const seenA = enterScope(a, () => reactiveScope())
        const seenB = enterScope(b, () => reactiveScope())
        expect(seenA).toBe(a)
        expect(seenB).toBe(b)
        expect(seenA).not.toBe(seenB)
    })

    test('a write inside one enterScope is not visible in another (per-request isolation)', () => {
        const requestOne = createReactiveScope()
        const requestTwo = createReactiveScope()

        enterScope(requestOne, () => {
            reactiveScope().slots.set('secret', 'user-1-data')
        })

        const leaked = enterScope(requestTwo, () => reactiveScope().slots.get('secret'))
        expect(leaked).toBeUndefined()

        // And request one still has its own value.
        const own = enterScope(requestOne, () => reactiveScope().slots.get('secret'))
        expect(own).toBe('user-1-data')
    })

    test('returns the value produced by fn', () => {
        const ctx = createReactiveScope()
        const result = enterScope(ctx, () => 7 * 6)
        expect(result).toBe(42)
    })
})

describe('enterScope nesting', () => {
    test('nested enterScope restores the parent context on exit', () => {
        const parent = createReactiveScope()
        const child = createReactiveScope()

        enterScope(parent, () => {
            expect(reactiveScope()).toBe(parent)

            enterScope(child, () => {
                expect(reactiveScope()).toBe(child)
            })

            // Parent restored after the nested scope exits.
            expect(reactiveScope()).toBe(parent)
        })
    })

    test('context is restored even when fn throws', () => {
        const outer = createReactiveScope()
        const inner = createReactiveScope()

        enterScope(outer, () => {
            expect(() => {
                enterScope(inner, () => {
                    throw new Error('boom')
                })
            }).toThrow('boom')

            // Despite the throw, the active context is back to outer.
            expect(reactiveScope()).toBe(outer)
        })
    })

    test('after leaving all scopes, reactiveScope falls back to the default again', () => {
        const scoped = createReactiveScope()
        enterScope(scoped, () => {
            expect(reactiveScope()).toBe(scoped)
        })

        const afterExit = reactiveScope()
        expect(afterExit).not.toBe(scoped)
    })
})

describe('enterScope across async boundaries', () => {
    test('the active context follows async continuations', async () => {
        const ctx = createReactiveScope()
        ctx.slots.set('token', 'abc')

        const value = await enterScope(ctx, async () => {
            await Promise.resolve()
            await new Promise((resolve) => setTimeout(resolve, 1))
            return reactiveScope().slots.get('token')
        })

        expect(value).toBe('abc')
    })

    test('concurrent enterScope scopes do not bleed into each other', async () => {
        const one = createReactiveScope()
        const two = createReactiveScope()
        one.slots.set('id', 1)
        two.slots.set('id', 2)

        const [a, b] = await Promise.all([
            enterScope(one, async () => {
                await new Promise((resolve) => setTimeout(resolve, 5))
                return reactiveScope().slots.get('id')
            }),
            enterScope(two, async () => {
                await new Promise((resolve) => setTimeout(resolve, 1))
                return reactiveScope().slots.get('id')
            }),
        ])

        expect(a).toBe(1)
        expect(b).toBe(2)
    })
})

// ── ADR 0026 — retain/release refcount ─────────────────────────────────────────────────────────────
//
// The mechanism that replaced `runInScope`'s `if (context.stream === undefined)` disposal branch. The
// contract is narrow and worth pinning directly, because both ways of getting it wrong are silent:
// releasing early tears down slots a streamed drain is still reading, and never releasing leaks every
// request's effect subscriptions onto module-level state.
describe('retain/release', () => {
    test('the implicit single hold disposes on first release', () => {
        let disposed = 0
        const context = createReactiveScope()
        enterScope(context, () => onScopeDispose(() => disposed++))

        releaseScope(context)
        expect(disposed).toBe(1)
    })

    test('a retain defers disposal until the matching release', () => {
        let disposed = 0
        const context = createReactiveScope()
        enterScope(context, () => onScopeDispose(() => disposed++))

        retainScope(context) // e.g. a streaming drain that outlives the handler
        releaseScope(context) // runInScope finishing
        expect(disposed).toBe(0) // still held — the drain is mid-flight

        releaseScope(context) // drain finished
        expect(disposed).toBe(1)
    })

    test('an extra release cannot dispose twice', () => {
        let disposed = 0
        const context = createReactiveScope()
        enterScope(context, () => onScopeDispose(() => disposed++))

        releaseScope(context)
        releaseScope(context)
        expect(disposed).toBe(1)
    })
})
