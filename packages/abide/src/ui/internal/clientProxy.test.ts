import { afterEach, expect, test } from 'bun:test'
import { GET } from '../../server/GET.ts'
import type { Mutation, Rpc } from '../../server/internal/makeRpc.ts'
import { buildRegistry } from '../../server/internal/registry.ts'
import type { Route } from '../../server/internal/router.ts'
import { POST } from '../../server/POST.ts'
import { clearTagRegistry } from '../../shared/internal/memoTags.ts'
import { invalidate } from '../../shared/invalidate.ts'
import { refresh } from '../../shared/refresh.ts'
import type { ValidationErrorData } from '../../shared/ValidationErrorData.ts'
import { createTestApp, type TestApp } from '../../test/createTestApp.ts'
import { clearClientProxyCache, clientProxy, makeClientImports } from './clientProxy.ts'

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

test('a memo:false read retains nothing — every bare call re-fetches', async () => {
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

// CLIENT/SERVER PARITY for `memo: false` (ADR 0027's thesis applied to the memo-option forwarding).
// The bare call was never the whole story: `peek`/`pending`/`watch` route through the BACKING memo on
// both sides, and the two backings were built by two independent derivations of one option. They
// disagreed — the server ran a `memo: false` read at `ttl: 0` while the wire shipped `ttl: null`
// (Infinity) and the browser memo cached it FOREVER. A correctness test over values could not see it;
// the observable is the WORK, so this counts handler runs on both sides of the same rpc.
test('a memo:false read has the same peek policy on the server and in the browser', async () => {
    let calls = 0
    const routes = {
        tick: GET((args: { id: number }) => ({ id: args.id, run: ++calls }), { memo: false }),
    }
    const app = await boot(routes)

    // SERVER: `peek` subscribes and kicks a load; nothing is retained, so the second peek loads again.
    routes.tick.peek({ id: 1 })
    await until(() => calls === 1)
    routes.tick.peek({ id: 1 })
    await until(() => calls === 2)
    const serverRuns = calls

    // The wire spec the client bundle actually ships for this rpc. `ttl: 0`, not `null` — the whole
    // divergence was this one field, and `memo` stays true because a READ still routes through the
    // memo at ttl:0 (only a `memo: false` MUTATION bypasses the bare call, on both sides).
    const spec = buildRegistry({ routes }).rpcs[0]
    if (spec === undefined) throw new Error('expected a registry entry')
    expect(spec.ttl).toBe(0)
    expect(spec.memo).toBe(true)

    // BROWSER: the same two peeks over the same spec must do the same work.
    calls = 0
    const proxy = makeClientImports({ tick: spec }, app.origin).tick as Rpc<
        { id: number },
        { id: number; run: number }
    >
    proxy.peek({ id: 1 })
    await until(() => calls === 1)
    proxy.peek({ id: 1 })
    await until(() => calls === 2)

    expect(calls).toBe(serverRuns)
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

// A 422 must NARROW on the client, not merely arrive. The proxy reads a typed error's name off the
// body's `name`, and the 422 used to be the one failure that spelled it `kind` — so this landed as an
// HttpError with no kind at all and `fn.isError(e, 'ValidationError')` was silently false in the
// browser while narrowing fine in-process. Asserting only `status` is what let that through.
test('read proxy throws a 422 that narrows to ValidationError and carries its fields', async () => {
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

    const caught = await greet({}).then(
        () => undefined,
        (e: unknown) => e,
    )
    expect(caught).toMatchObject({ name: 'HttpError', status: 422 })
    expect(greet.isError(caught, 'ValidationError')).toBe(true)
    expect(greet.isError(caught, 'SomethingElse')).toBe(false)
    expect((caught as { data: ValidationErrorData }).data.fields.name).toBeDefined()
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

// A proxy is ONE object per (base, rpc name) for the life of the tab. Two comments already asserted
// this — the tag-registration note here, and `refresh({ tags })`'s documented reach across args-keys "no
// longer on screen" — while `makeClientImports` minted a fresh one per call, i.e. per page MOUNT.
//
// The tag registry is where that bit. `memo.ts` disposes a tagged memo's registration through an effect
// scope or a request scope; a client proxy is in neither, on the stated premise that it is module-level
// and so "stays registered for the process, which is exactly as long as it lives". Per-mount proxies do
// not live that long, so every navigation left a permanent entry pinning a dead memo's whole slot map.
// Identity is the honest assertion: the registry itself is not introspectable, but one proxy per name
// is exactly what makes one registration per name true.
test('makeClientImports returns the SAME proxy for a repeated (base, name) — one memo, one registration', () => {
    const specs = { greet: { method: 'GET', read: true } }
    const first = makeClientImports(specs, 'http://example.test')
    const second = makeClientImports(specs, 'http://example.test')
    expect(second.greet).toBe(first.greet)

    // Keyed on base too: a cross-origin proxy (ABIDE_APP_URL) is a different endpoint with its own
    // slots, and collapsing the two would serve one origin's cache to the other.
    const elsewhere = makeClientImports(specs, 'http://other.test')
    expect(elsewhere.greet).not.toBe(first.greet)

    // …and the cache is module state, so tests have to be able to drop it.
    clearClientProxyCache()
    expect(makeClientImports(specs, 'http://example.test').greet).not.toBe(first.greet)
})
