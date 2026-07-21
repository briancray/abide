import { describe, expect, test } from 'bun:test'
import { cell } from '../../shared/cell.ts'
import { getContext } from '../../shared/internal/context.ts'
import { route } from '../../shared/route.ts'
import { context } from '../context.ts'
import { cookies } from '../cookies.ts'
import { identity } from '../identity.ts'
import { request } from '../request.ts'
import { server } from '../server.ts'
import { anonymousPrincipal, currentScope, type RequestScope, runInScope } from './scope.ts'

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

describe('accessors outside a scope', () => {
    test('every accessor throws and currentScope is undefined', () => {
        expect(currentScope()).toBeUndefined()
        expect(() => request()).toThrow()
        expect(() => cookies()).toThrow()
        expect(() => server()).toThrow()
        expect(() => context()).toThrow()
        expect(() => identity()).toThrow()
        expect(() => route()).toThrow()
    })
})

describe('accessors inside a scope', () => {
    test("each accessor returns the active scope's values", async () => {
        const scope = makeScope()
        await runInScope(scope, () => {
            expect(currentScope()).toBe(scope)
            expect(request()).toBe(scope.request)
            expect(cookies()).toBe(scope.cookies)
            expect(context()).toBe(scope.bag)
            expect(identity()).toBe(scope.identity)
            expect(route()).toBe(scope.route)
        })
    })

    test('server() returns the bound server, or throws when absent', async () => {
        const fakeServer = {} as unknown as Bun.Server<undefined>
        await runInScope(makeScope({ server: fakeServer }), () => {
            expect(server()).toBe(fakeServer)
        })
        await runInScope(makeScope(), () => {
            expect(() => server()).toThrow()
        })
    })

    test('returns the value produced by fn', async () => {
        const result = await runInScope(makeScope(), () => 6 * 7)
        expect(result).toBe(42)
    })
})

describe('scope isolation', () => {
    test('two runInScope calls have separate identity, bag, and cache', async () => {
        const a = makeScope()
        const b = makeScope()
        a.bag.value = 'a'
        b.bag.value = 'b'

        await runInScope(a, () => {
            expect(context()).toBe(a.bag)
            expect(identity()).toBe(a.identity)
            expect(getContext().cache).toBe(a.cache)
        })
        await runInScope(b, () => {
            expect(context()).toBe(b.bag)
            expect(identity()).toBe(b.identity)
            expect(getContext().cache).toBe(b.cache)
        })

        expect(a.identity.id).not.toBe(b.identity.id)
        expect(a.cache).not.toBe(b.cache)
        expect(a.bag).not.toBe(b.bag)
    })

    test('concurrent scopes do not bleed into each other', async () => {
        const one = makeScope()
        const two = makeScope()

        const [seenOne, seenTwo] = await Promise.all([
            runInScope(one, async () => {
                await new Promise((resolve) => setTimeout(resolve, 5))
                return currentScope()
            }),
            runInScope(two, async () => {
                await new Promise((resolve) => setTimeout(resolve, 1))
                return currentScope()
            }),
        ])

        expect(seenOne).toBe(one)
        expect(seenTwo).toBe(two)
    })
})

describe('M1 cache integration', () => {
    test('getContext().cache is the same Map as scope.cache', async () => {
        const scope = makeScope()
        await runInScope(scope, () => {
            expect(getContext().cache).toBe(scope.cache)
        })
    })

    test('a cell load inside the scope stores into scope.cache', async () => {
        const scope = makeScope()
        const double = cell(async (n: number) => n * 2)

        await runInScope(scope, async () => {
            expect(scope.cache.size).toBe(0)
            const value = await double.load(5)
            expect(value).toBe(10)
            expect(scope.cache.size).toBeGreaterThan(0)
        })

        // The write landed in this request's cache and nowhere global.
        expect(scope.cache.size).toBeGreaterThan(0)
    })

    test('cell caches are isolated per scope', async () => {
        const double = cell(async (n: number) => n * 2)
        const a = makeScope()
        const b = makeScope()

        await runInScope(a, async () => {
            await double.load(3)
        })
        await runInScope(b, () => {
            // b never loaded, so its cache is untouched by a's load.
            expect(b.cache.size).toBe(0)
        })
        expect(a.cache.size).toBeGreaterThan(0)
    })
})

describe('identity stub', () => {
    test('defaults to anonymous and set/clear mutate the scope identity', async () => {
        const scope = makeScope()
        await runInScope(scope, () => {
            expect(identity().authenticated).toBe(false)
            expect(typeof identity().id).toBe('string')

            identity.set({ id: 'user-1', authenticated: true, role: 'admin' })
            expect(scope.identity.id).toBe('user-1')
            expect(scope.identity.authenticated).toBe(true)
            expect(scope.identity.role).toBe('admin')
            expect(identity().id).toBe('user-1')

            identity.clear()
            expect(identity().authenticated).toBe(false)
            expect(identity().role).toBeUndefined()
            expect(identity().id).not.toBe('user-1')
        })
    })

    test('identity.set throws outside a scope', () => {
        expect(() => identity.set({ id: 'x' })).toThrow()
        expect(() => identity.clear()).toThrow()
    })
})
