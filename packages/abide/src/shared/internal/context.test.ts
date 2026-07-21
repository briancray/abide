import { describe, expect, test } from 'bun:test'
import { createContext, getContext, runInContext } from './context.ts'

describe('createContext', () => {
    test('returns a fresh context with an empty cache', () => {
        const ctx = createContext()
        expect(ctx.cache).toBeInstanceOf(Map)
        expect(ctx.cache.size).toBe(0)
    })

    test('each call is a distinct context with a distinct cache', () => {
        const a = createContext()
        const b = createContext()
        expect(a).not.toBe(b)
        expect(a.cache).not.toBe(b.cache)
        a.cache.set('x', 1)
        expect(b.cache.has('x')).toBe(false)
    })
})

describe('getContext (no active context)', () => {
    test('returns a default context rather than throwing (bare script / cron)', () => {
        const ctx = getContext()
        expect(ctx.cache).toBeInstanceOf(Map)
    })

    test('the default context is stable across calls (same instance)', () => {
        const first = getContext()
        const second = getContext()
        expect(first).toBe(second)
        expect(first.cache).toBe(second.cache)
    })

    test('the default context retains writes across calls', () => {
        getContext().cache.set('persisted', 42)
        expect(getContext().cache.get('persisted')).toBe(42)
    })
})

describe('runInContext isolation', () => {
    test('getContext inside runInContext returns the supplied context', () => {
        const ctx = createContext()
        const seen = runInContext(ctx, () => getContext())
        expect(seen).toBe(ctx)
        expect(seen.cache).toBe(ctx.cache)
    })

    test('two runInContext calls get separate caches', () => {
        const a = createContext()
        const b = createContext()
        const seenA = runInContext(a, () => getContext())
        const seenB = runInContext(b, () => getContext())
        expect(seenA).toBe(a)
        expect(seenB).toBe(b)
        expect(seenA).not.toBe(seenB)
    })

    test('a write inside one runInContext is not visible in another (per-request isolation)', () => {
        const requestOne = createContext()
        const requestTwo = createContext()

        runInContext(requestOne, () => {
            getContext().cache.set('secret', 'user-1-data')
        })

        const leaked = runInContext(requestTwo, () => getContext().cache.get('secret'))
        expect(leaked).toBeUndefined()

        // And request one still has its own value.
        const own = runInContext(requestOne, () => getContext().cache.get('secret'))
        expect(own).toBe('user-1-data')
    })

    test('returns the value produced by fn', () => {
        const ctx = createContext()
        const result = runInContext(ctx, () => 7 * 6)
        expect(result).toBe(42)
    })
})

describe('runInContext nesting', () => {
    test('nested runInContext restores the parent context on exit', () => {
        const parent = createContext()
        const child = createContext()

        runInContext(parent, () => {
            expect(getContext()).toBe(parent)

            runInContext(child, () => {
                expect(getContext()).toBe(child)
            })

            // Parent restored after the nested scope exits.
            expect(getContext()).toBe(parent)
        })
    })

    test('context is restored even when fn throws', () => {
        const outer = createContext()
        const inner = createContext()

        runInContext(outer, () => {
            expect(() => {
                runInContext(inner, () => {
                    throw new Error('boom')
                })
            }).toThrow('boom')

            // Despite the throw, the active context is back to outer.
            expect(getContext()).toBe(outer)
        })
    })

    test('after leaving all scopes, getContext falls back to the default again', () => {
        const scoped = createContext()
        runInContext(scoped, () => {
            expect(getContext()).toBe(scoped)
        })

        const afterExit = getContext()
        expect(afterExit).not.toBe(scoped)
    })
})

describe('runInContext across async boundaries', () => {
    test('the active context follows async continuations', async () => {
        const ctx = createContext()
        ctx.cache.set('token', 'abc')

        const value = await runInContext(ctx, async () => {
            await Promise.resolve()
            await new Promise((resolve) => setTimeout(resolve, 1))
            return getContext().cache.get('token')
        })

        expect(value).toBe('abc')
    })

    test('concurrent runInContext scopes do not bleed into each other', async () => {
        const one = createContext()
        const two = createContext()
        one.cache.set('id', 1)
        two.cache.set('id', 2)

        const [a, b] = await Promise.all([
            runInContext(one, async () => {
                await new Promise((resolve) => setTimeout(resolve, 5))
                return getContext().cache.get('id')
            }),
            runInContext(two, async () => {
                await new Promise((resolve) => setTimeout(resolve, 1))
                return getContext().cache.get('id')
            }),
        ])

        expect(a).toBe(1)
        expect(b).toBe(2)
    })
})
