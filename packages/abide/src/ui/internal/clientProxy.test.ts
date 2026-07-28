import { afterEach, expect, test } from 'bun:test'
import { GET } from '../../server/GET.ts'
import type { Mutation, Rpc } from '../../server/internal/makeRpc.ts'
import type { Route } from '../../server/internal/router.ts'
import { POST } from '../../server/POST.ts'
import { clearTagRegistry } from '../../shared/internal/memoTags.ts'
import { invalidate } from '../../shared/invalidate.ts'
import { refresh } from '../../shared/refresh.ts'
import { createTestApp, type TestApp } from '../../test/createTestApp.ts'
import { clientProxy, makeClientImports } from './clientProxy.ts'

let running: TestApp | undefined

async function boot(routes: Record<string, Route>): Promise<TestApp> {
    running = await createTestApp({ routes })
    return running
}

afterEach(async () => {
    await running?.stop()
    running = undefined
})

test('read proxy fetches and returns the handler value', async () => {
    const app = await boot({ greet: GET((args: { name: string }) => `hello ${args.name}`) })
    const greet = clientProxy<{ name: string }, string>('greet', 'GET', {
        base: app.origin,
    }) as Rpc<{ name: string }, string>

    expect(await greet({ name: 'x' })).toBe('hello x')
})

test('read proxy coalesces/caches repeated loads (handler runs once)', async () => {
    let calls = 0
    const app = await boot({
        greet: GET((args: { name: string }) => {
            calls++
            return `hi ${args.name}`
        }),
    })
    const greet = clientProxy<{ name: string }, string>('greet', 'GET', {
        base: app.origin,
    }) as Rpc<{ name: string }, string>

    const [a, b] = await Promise.all([greet({ name: 'y' }), greet({ name: 'y' })])
    expect(a).toBe('hi y')
    expect(b).toBe('hi y')
    // A third settled read hits the cache, not the network.
    expect(await greet({ name: 'y' })).toBe('hi y')
    expect(calls).toBe(1)
})

test('a memo:false read bypasses the client memo — every bare call re-fetches', async () => {
    let calls = 0
    const app = await boot({
        tick: GET(() => ++calls, { memo: false }),
    })
    const tick = clientProxy<Record<string, never>, number>('tick', 'GET', {
        base: app.origin,
        memo: false,
    }) as Rpc<Record<string, never>, number>

    // `memo: false` opts out of the memo entirely: each bare call runs the handler fresh.
    expect(await tick({})).toBe(1)
    expect(await tick({})).toBe(2)
    expect(await tick({})).toBe(3)
    expect(calls).toBe(3)
})

test('invalidate forces a re-fetch', async () => {
    let calls = 0
    const app = await boot({
        greet: GET((args: { name: string }) => {
            calls++
            return `hi ${args.name}#${calls}`
        }),
    })
    const greet = clientProxy<{ name: string }, string>('greet', 'GET', {
        base: app.origin,
    }) as Rpc<{ name: string }, string>

    expect(await greet({ name: 'z' })).toBe('hi z#1')
    expect(await greet({ name: 'z' })).toBe('hi z#1') // cached
    greet.invalidate({ name: 'z' })
    expect(await greet({ name: 'z' })).toBe('hi z#2') // re-fetched
    expect(calls).toBe(2)
})

test('mutation proxy posts a JSON body and returns the value', async () => {
    const app = await boot({
        bump: POST((args: { n: number }) => ({ next: args.n + 1 })),
    })
    const bump = clientProxy<{ n: number }, { next: number }>('bump', 'POST', {
        base: app.origin,
    }) as Mutation<{ n: number }, { next: number }>

    expect(await bump({ n: 41 })).toEqual({ next: 42 })
})

test('read proxy throws HttpError-like on non-2xx (404 unknown rpc)', async () => {
    const app = await boot({ greet: GET(() => 'ok') })
    const missing = clientProxy<Record<string, never>, string>('nope', 'GET', {
        base: app.origin,
    }) as Rpc<Record<string, never>, string>

    await expect(missing({})).rejects.toMatchObject({ name: 'HttpError', status: 404 })
})

test('read proxy throws on 422 validation failure', async () => {
    const app = await boot({
        greet: GET((args: { name: string }) => `hello ${args.name}`, {
            schemas: {
                input: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                },
            },
        }),
    })
    const greet = clientProxy<{ name?: string }, string>('greet', 'GET', {
        base: app.origin,
    }) as Rpc<{ name?: string }, string>

    await expect(greet({})).rejects.toMatchObject({ name: 'HttpError', status: 422 })
})

test('makeClientImports builds a name -> proxy map', () => {
    const imports = makeClientImports(
        { greet: { method: 'GET', read: true }, bump: { method: 'POST', read: false } },
        'http://example.test',
    )
    expect(Object.keys(imports).sort()).toEqual(['bump', 'greet'])
    expect(typeof imports.greet).toBe('function')
    expect(typeof imports.bump).toBe('function')
    // Both proxies carry the identical reactive surface — full read/mutation symmetry.
    expect(typeof (imports.bump as Rpc<unknown, unknown>).refresh).toBe('function')
    expect(typeof (imports.bump as Rpc<unknown, unknown>).peek).toBe('function')
})

// The client half of isomorphic cache tags. A browser memo is never `crossRequest`, so until tags were
// carried across the spec hops (registry → clientBundle → makeClientImports → clientProxy) a
// `refresh({ tags })`/`invalidate({ tags })` in the browser matched an empty registry and did nothing.
test('a tagged read proxy is reachable by invalidate({ tags })', async () => {
    let calls = 0
    const app = await boot({
        counted: GET(() => {
            calls++
            return { calls }
        }),
    })
    const counted = clientProxy<undefined, { calls: number }>('counted', 'GET', {
        base: app.origin,
        tags: ['widgets'],
    }) as Rpc<undefined, { calls: number }>

    expect((await counted(undefined)).calls).toBe(1)
    expect((await counted(undefined)).calls).toBe(1) // memoized client-side

    invalidate({ tags: ['widgets'] })
    expect((await counted(undefined)).calls).toBe(2) // the tag verb reached the CLIENT memo
    clearTagRegistry()
})

test('makeClientImports threads tags from the spec into the proxy memo', async () => {
    let calls = 0
    const app = await boot({
        tagged: GET(() => {
            calls++
            return { calls }
        }),
    })
    const imports = makeClientImports(
        { tagged: { method: 'GET', read: true, tags: ['fromSpec'] } },
        app.origin,
    )
    const tagged = imports.tagged as Rpc<undefined, { calls: number }>

    expect((await tagged(undefined)).calls).toBe(1)
    refresh({ tags: ['fromSpec'] })
    // Polled, not slept: `refresh` is eager but the re-run is a real HTTP round trip, and a fixed
    // sleep sized on an idle machine is what makes a parallel suite flaky.
    await until(() => calls === 2)
    expect(calls).toBe(2)
    clearTagRegistry()
})

// Wait for a condition instead of sleeping a guessed interval — the suite runs in parallel, so a
// fixed sleep sized on an idle machine turns into an intermittent failure under load.
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('until: condition not met before the deadline')
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
}

// The client half of the SWR refetch clock (rpc-core §3). The browser is where a refresh storm actually
// happens — a socket broadcast calling `fn.refresh()` per frame — so the clock has to survive the spec
// hops (registry → clientBundle → makeClientImports → clientProxy) or it rate-limits only the server.
//
// The triggers are SPREAD rather than fired back-to-back on purpose: three instant refreshes coalesce
// onto one in-flight load even with NO clock at all, so a burst cannot tell the two implementations
// apart. Spaced past a loopback round trip, each one would fire its own refetch — which is what makes
// the `calls` count below evidence rather than coincidence.
test('a throttled read proxy collapses spread-out refreshes into one refetch', async () => {
    let calls = 0
    const app = await boot({
        counted: GET(() => {
            calls++
            return { calls }
        }),
    })
    const imports = makeClientImports(
        { counted: { method: 'GET', read: true, throttle: 300 } },
        app.origin,
    )
    const counted = imports.counted as Rpc<undefined, { calls: number }>

    expect((await counted(undefined)).calls).toBe(1)

    counted.refresh() // leading edge — fires at once
    await until(() => calls === 2)

    for (let index = 0; index < 3; index++) {
        counted.refresh()
        await new Promise((resolve) => setTimeout(resolve, 40))
    }
    // Un-throttled these would be three separate refetches (calls === 5). Throttled, they are ONE
    // trailing load that has not fired yet.
    expect(calls).toBe(2)

    await until(() => calls === 3)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(calls).toBe(3) // exactly one trailing refetch, not three
})
