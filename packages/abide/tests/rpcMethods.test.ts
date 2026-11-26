// 16.111-16.116 — ONE `rpc`, ITS VERBS READ OFF ITS VALUE: a function is read by `GET`, a value is read
// by `GET` and written by `PUT` and `PATCH`, and `methods` names others. A `GET` whose args outgrow its
// URL is sent as `QUERY`, and a browser's write of a value is the server's.

import { afterEach, expect, test } from 'bun:test'

import { rpc } from '#server'
import { HandlerRoute } from '#shared/HandlerRoute.ts'
import { rpcRequest } from '#shared/rpcRequest.ts'
import { wire } from '#ui/wire.ts'

import { inMemoryApp } from './inMemoryApp.ts'

const unstubbedFetch = globalThis.fetch
afterEach(() => {
    globalThis.fetch = unstubbedFetch
})

// 16.111, 16.112 — THE VERBS ARE THE VALUE'S, or the ones `methods` names, and one it cannot answer by
// is refused where it is declared. THE REVERT: drop the checks in `verbsOf`; the three refusals
// below are `ok` where `RULEBOOK 16.112` is due.
test('an rpc answers the verbs its value does, or the ones methods names — 16.111, 16.112', () => {
    expect(rpc(() => 1).methods).toEqual(['GET'])
    expect(rpc(() => 1, { methods: ['POST'] }).method).toBe('POST')
    expect(rpc({ theme: 'dark' }).methods).toEqual(['GET', 'PUT', 'PATCH'])
    expect(rpc({ theme: 'dark' }, { methods: ['GET'] }).methods).toEqual([
        'GET',
    ])
    const refused = (declare: () => unknown): string => {
        try {
            declare()
            return 'ok'
        } catch (thrown) {
            return /RULEBOOK 16\.112/.test(String(thrown))
                ? 'RULEBOOK 16.112'
                : String(thrown)
        }
    }
    expect([
        refused(() => rpc(() => 1, { methods: ['GET', 'POST'] })),
        refused(() => rpc(1, { methods: ['POST'] })),
        refused(() => rpc(1, { methods: ['PUT'] })),
    ]).toEqual(['RULEBOOK 16.112', 'RULEBOOK 16.112', 'RULEBOOK 16.112'])
})

// 16.114 — A `GET` WHOSE ARGS OUTGROW ITS URL IS SENT AS `QUERY`, its args in the body, and the server
// answers it as the `GET`. THE REVERTS: drop the `LONGEST_URL` arm in `rpcRequest`; the long call is
// sent as a `GET`. Drop `QUERY` from `readsAsGet` in `answerRequest`; the server answers 405.
test('a GET whose args outgrow its URL is sent as QUERY and answered as the GET — 16.114', async () => {
    const route = new HandlerRoute('/deals/search')
    const short = rpcRequest('GET', route, { q: 'acme' })
    const long = rpcRequest('GET', route, { q: 'x'.repeat(3_000) })
    expect([short.init.method, long.init.method]).toEqual(['GET', 'QUERY'])
    expect(long.url).toBe('/deals/search')
    const search = rpc(({ q }: { q: string }) => q.length)
    await using app = await inMemoryApp({
        'deals/search.server.ts': { default: search },
    })
    const answer = await app.fetch(
        new Request(`http://app.invalid${long.url}`, long.init),
    )
    expect(`${answer.status} ${await answer.text()}`).toBe('200 3000')
})

// 16.115 — A VALUE'S `PUT` WRITES IT AND ITS `PATCH` APPLIES A JSON PATCH, each answering the value
// then held. THE REVERT: give `rpc` no faces for a value's writes; both answer 405.
test("a value's PUT writes it and its PATCH patches it, each answering the value — 16.115", async () => {
    const settings = rpc({ theme: 'dark', seats: 40 })
    await using app = await inMemoryApp({
        'account/settings.server.ts': { default: settings },
    })
    const send = async (method: string, body: unknown) => {
        const answer = await app.fetch(
            new Request('http://app.invalid/account/settings', {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            }),
        )
        return `${answer.status} ${await answer.text()}`
    }
    expect(await send('PUT', { value: { theme: 'light', seats: 40 } })).toBe(
        '200 {"theme":"light","seats":40}',
    )
    expect(
        await send('PATCH', {
            ops: [{ op: 'replace', path: '/seats', value: 45 }],
        }),
    ).toBe('200 {"theme":"light","seats":45}')
    expect(await settings()).toEqual({ theme: 'light', seats: 45 })
})

// 16.116 — A BROWSER'S WRITE OF A VALUE IS SENT: `set` as a `PUT` of the value, `patch` as a `PATCH` of
// the ops it made. THE REVERT: skip `sendsWrites` in `wire`; nothing is sent.
test("a browser's set and patch of a value are sent as PUT and PATCH — 16.116", async () => {
    const sent: string[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        if (method !== 'GET')
            sent.push(`${method} ${url} ${String(init?.body)}`)
        return new Response(JSON.stringify({ seats: 41 }), {
            headers: { 'content-type': 'application/json' },
        })
    }) as unknown as typeof fetch
    const copy = wire(['GET', 'PUT', 'PATCH'], '/account/seats') as {
        set(value: unknown): void
        patch(mutate: (value: { seats: number }) => void): void
        (): Promise<unknown>
    }
    await copy()
    copy.set({ seats: 41 })
    copy.patch((held) => {
        held.seats = 42
    })
    await Bun.sleep(10)
    expect(sent).toEqual([
        'PUT /account/seats {"value":{"seats":41}}',
        'PATCH /account/seats {"ops":[{"op":"replace","path":"/seats","value":42}]}',
    ])
})
