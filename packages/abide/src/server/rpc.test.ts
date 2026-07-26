import { describe, expect, test } from 'bun:test'
import { DELETE } from './DELETE.ts'
import { GET } from './GET.ts'
import { HEAD } from './HEAD.ts'
import { anonymousPrincipal, type RequestScope, runInScope } from './internal/scope.ts'
import { PATCH } from './PATCH.ts'
import { POST } from './POST.ts'
import { PUT } from './PUT.ts'

// Every test runs inside a fresh request scope so the read memo has a cache to write into and
// slots never leak between tests.
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

describe('read RPC (GET/HEAD) — cache + coalesce', () => {
    test('two loads with the same args call the handler once', async () => {
        let calls = 0
        const get = GET(async (n: number) => {
            calls++
            return n * 2
        })

        await runInScope(makeScope(), async () => {
            expect(await get(5)).toBe(10)
            expect(await get(5)).toBe(10)
            expect(calls).toBe(1)
        })
    })

    test('distinct args produce distinct cached slots', async () => {
        let calls = 0
        const get = GET(async (n: number) => {
            calls++
            return n + 1
        })

        await runInScope(makeScope(), async () => {
            expect(await get(1)).toBe(2)
            expect(await get(2)).toBe(3)
            expect(await get(1)).toBe(2)
            expect(calls).toBe(2)
        })
    })

    test('invalidate drops the slot so the next load re-calls the handler', async () => {
        let calls = 0
        const get = GET(async (n: number) => {
            calls++
            return n * 10
        })

        await runInScope(makeScope(), async () => {
            expect(await get(3)).toBe(30)
            expect(calls).toBe(1)
            get.invalidate(3)
            expect(await get(3)).toBe(30)
            expect(calls).toBe(2)
        })
    })

    test('read rpc exposes the reactive read surface', async () => {
        const get = GET(async (n: number) => n)
        await runInScope(makeScope(), async () => {
            expect(typeof get.peek).toBe('function')
            expect(typeof get.pending).toBe('function')
            expect(typeof get.error).toBe('function')
            expect(typeof get.refresh).toBe('function')

            const loading = get(7)
            expect(get.pending(7)).toBe(true)
            expect(get.peek(7)).toBeUndefined()
            await loading
            expect(get.pending(7)).toBe(false)
            expect(get.peek(7)).toBe(7)
        })
    })

    test('read rpc exposes raw / isError / refreshing / watch (call surface)', async () => {
        const get = GET(async ({ n = 0 }: { n?: number }) => ({ doubled: n * 2 }))
        await runInScope(makeScope(), async () => {
            // raw — full bypass, returns a Response with the handler's value as JSON.
            const response = await get.raw({ n: 3 })
            expect(response).toBeInstanceOf(Response)
            expect(await response.json()).toEqual({ doubled: 6 })

            // isError — narrows a typed error by name (kind or name).
            expect(get.isError({ kind: 'RateLimited' }, 'RateLimited')).toBe(true)
            expect(get.isError({ name: 'RateLimited' }, 'RateLimited')).toBe(true)
            expect(get.isError({ kind: 'Other' }, 'RateLimited')).toBe(false)
            expect(get.isError(new Error('x'), 'RateLimited')).toBe(false)

            // refreshing + watch are forwarded from the memo.
            expect(typeof get.refreshing).toBe('function')
            expect(get.refreshing({ n: 1 })).toBe(false)
            const seen: unknown[] = []
            const dispose = get.watch({ n: 5 }, (v) => seen.push(v))
            await get({ n: 5 })
            // watch fires on each VALUE change; the settled value is the last (and only) one seen.
            expect(seen.at(-1)).toEqual({ doubled: 10 })
            dispose()
        })
    })

    test('HEAD behaves as a read (caches like GET)', async () => {
        let calls = 0
        const head = HEAD(async (n: number) => {
            calls++
            return n
        })
        await runInScope(makeScope(), async () => {
            await head(1)
            await head(1)
            expect(calls).toBe(1)
        })
    })
})

describe('mutation RPC (POST/PUT/PATCH/DELETE) — no cache', () => {
    test('POST calls the handler every time and returns the value', async () => {
        let calls = 0
        const post = POST(async (n: number) => {
            calls++
            return n + 100
        })

        await runInScope(makeScope(), async () => {
            expect(await post(1)).toBe(101)
            expect(await post(1)).toBe(101)
            expect(await post(2)).toBe(102)
            expect(calls).toBe(3)
        })
    })

    test('a mutation exposes the FULL cache surface (symmetry with a read)', async () => {
        const post = POST(async (n: number) => n)
        // Every reactive probe + cache verb + raw is present, exactly like a read.
        for (const method of [
            'peek',
            'pending',
            'refreshing',
            'error',
            'watch',
            'refresh',
            'invalidate',
            'publish',
            'snapshot',
            'seed',
            'raw',
            'isError',
        ] as const) {
            expect(typeof (post as unknown as Record<string, unknown>)[method]).toBe('function')
        }
    })

    test('a mutation call is always a fresh promise resolving to the return value', async () => {
        const del = DELETE((id: string) => `deleted:${id}`)
        await runInScope(makeScope(), async () => {
            const first = del('a')
            const second = del('a')
            expect(first).not.toBe(second)
            expect(await first).toBe('deleted:a')
            expect(await second).toBe('deleted:a')
        })
    })

    test('an author-cached mutation (memo: { ttl }) RETAINS and its probes reflect it', async () => {
        let calls = 0
        const post = POST(
            async (n: number) => {
                calls++
                return n * 10
            },
            { memo: { ttl: 60_000 } },
        )
        await runInScope(makeScope(), async () => {
            expect(await post(5)).toBe(50)
            // Retained: a second identical call within ttl resolves from cache, handler not re-run.
            expect(await post(5)).toBe(50)
            expect(calls).toBe(1)
            // The reactive probe sees the retained value — full symmetry with a read.
            expect(post.peek(5)).toBe(50)
            // refresh re-runs the handler.
            post.refresh(5)
            expect(await post(5)).toBe(50)
            expect(calls).toBe(2)
        })
    })

    test('memo: false opts the CALL out of the memo (at-least-once) but keeps the surface', async () => {
        let calls = 0
        const post = POST(
            async (n: number) => {
                calls++
                return n
            },
            { memo: false },
        )
        await runInScope(makeScope(), async () => {
            await post(1)
            await post(1)
            // Every call runs — no coalescing/retention.
            expect(calls).toBe(2)
            // Surface still present (probes read an empty slot).
            expect(typeof post.peek).toBe('function')
            expect(post.peek(1)).toBeUndefined()
        })
    })
})

describe('__rpc router metadata', () => {
    test('method and read flag are correct for every verb', () => {
        const noop = () => 0
        expect(GET(noop).__rpc.method).toBe('GET')
        expect(GET(noop).__rpc.read).toBe(true)
        expect(HEAD(noop).__rpc.method).toBe('HEAD')
        expect(HEAD(noop).__rpc.read).toBe(true)

        expect(POST(noop).__rpc.method).toBe('POST')
        expect(POST(noop).__rpc.read).toBe(false)
        expect(PUT(noop).__rpc.method).toBe('PUT')
        expect(PUT(noop).__rpc.read).toBe(false)
        expect(PATCH(noop).__rpc.method).toBe('PATCH')
        expect(PATCH(noop).__rpc.read).toBe(false)
        expect(DELETE(noop).__rpc.method).toBe('DELETE')
        expect(DELETE(noop).__rpc.read).toBe(false)
    })

    test('__rpc carries the original handler and the passed options', () => {
        const handler = (n: number) => n
        const options = { timeout: 1000, memo: { ttl: 50 } }
        const get = GET(handler, options)
        expect(get.__rpc.handler).toBe(handler)
        expect(get.__rpc.options).toBe(options)
    })
})
