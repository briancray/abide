import { afterEach, expect, test } from 'bun:test'
import { GET } from '../../server/GET.ts'
import type { Mutation, Rpc } from '../../server/internal/makeRpc.ts'
import type { Route } from '../../server/internal/router.ts'
import { POST } from '../../server/POST.ts'
import { createTestApp, type TestApp } from '../../test/createTestApp.ts'
import { clientProxy, makeClientImports } from './clientProxy.ts'

let running: TestApp | undefined

function boot(routes: Record<string, Route>): TestApp {
    running = createTestApp({ routes })
    return running
}

afterEach(async () => {
    await running?.stop()
    running = undefined
})

test('read proxy fetches and returns the handler value', async () => {
    const app = boot({ greet: GET((args: { name: string }) => `hello ${args.name}`) })
    const greet = clientProxy<{ name: string }, string>('greet', 'GET', {
        base: app.origin,
    }) as Rpc<{ name: string }, string>

    expect(await greet.load({ name: 'x' })).toBe('hello x')
})

test('read proxy coalesces/caches repeated loads (handler runs once)', async () => {
    let calls = 0
    const app = boot({
        greet: GET((args: { name: string }) => {
            calls++
            return `hi ${args.name}`
        }),
    })
    const greet = clientProxy<{ name: string }, string>('greet', 'GET', {
        base: app.origin,
    }) as Rpc<{ name: string }, string>

    const [a, b] = await Promise.all([greet.load({ name: 'y' }), greet.load({ name: 'y' })])
    expect(a).toBe('hi y')
    expect(b).toBe('hi y')
    // A third settled read hits the cache, not the network.
    expect(await greet.load({ name: 'y' })).toBe('hi y')
    expect(calls).toBe(1)
})

test('a cache:false read bypasses the client cell — every bare call re-fetches', async () => {
    let calls = 0
    const app = boot({
        tick: GET(() => ++calls, { cache: false }),
    })
    const tick = clientProxy<Record<string, never>, number>('tick', 'GET', {
        base: app.origin,
        cache: false,
    }) as Rpc<Record<string, never>, number>

    // `cache: false` opts out of the cell entirely: each bare call runs the handler fresh.
    expect(await tick({})).toBe(1)
    expect(await tick({})).toBe(2)
    expect(await tick({})).toBe(3)
    expect(calls).toBe(3)
})

test('invalidate forces a re-fetch', async () => {
    let calls = 0
    const app = boot({
        greet: GET((args: { name: string }) => {
            calls++
            return `hi ${args.name}#${calls}`
        }),
    })
    const greet = clientProxy<{ name: string }, string>('greet', 'GET', {
        base: app.origin,
    }) as Rpc<{ name: string }, string>

    expect(await greet.load({ name: 'z' })).toBe('hi z#1')
    expect(await greet.load({ name: 'z' })).toBe('hi z#1') // cached
    greet.invalidate({ name: 'z' })
    expect(await greet.load({ name: 'z' })).toBe('hi z#2') // re-fetched
    expect(calls).toBe(2)
})

test('mutation proxy posts a JSON body and returns the value', async () => {
    const app = boot({
        bump: POST((args: { n: number }) => ({ next: args.n + 1 })),
    })
    const bump = clientProxy<{ n: number }, { next: number }>('bump', 'POST', {
        base: app.origin,
    }) as Mutation<{ n: number }, { next: number }>

    expect(await bump({ n: 41 })).toEqual({ next: 42 })
})

test('read proxy throws HttpError-like on non-2xx (404 unknown rpc)', async () => {
    const app = boot({ greet: GET(() => 'ok') })
    const missing = clientProxy<Record<string, never>, string>('nope', 'GET', {
        base: app.origin,
    }) as Rpc<Record<string, never>, string>

    await expect(missing.load({})).rejects.toMatchObject({ name: 'HttpError', status: 404 })
})

test('read proxy throws on 422 validation failure', async () => {
    const app = boot({
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

    await expect(greet.load({})).rejects.toMatchObject({ name: 'HttpError', status: 422 })
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
    expect(typeof (imports.greet as Rpc<unknown, unknown>).load).toBe('function')
    expect(typeof (imports.bump as Rpc<unknown, unknown>).load).toBe('function')
    expect(typeof (imports.bump as Rpc<unknown, unknown>).refresh).toBe('function')
    expect(typeof (imports.bump as Rpc<unknown, unknown>).peek).toBe('function')
})
