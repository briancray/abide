// 16.111-16.116 — ONE `rpc`, ITS VERBS READ OFF ITS VALUE: a function and a value are read by `GET`,
// and `methods` names others — a value's `PUT` and `PATCH` among them. A `GET` whose args outgrow its
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
// is refused where it is declared. THE REVERT: drop the checks in `calledVerbs` and `sourceVerbs`; the three refusals
// below are `ok` where `RULEBOOK 16.112` is due.
test('an rpc answers the verbs its value does, or the ones methods names — 16.111, 16.112', () => {
    expect(rpc(() => 1).methods).toEqual(['GET'])
    expect(rpc(() => 1, { methods: ['POST'] }).method).toBe('POST')
    expect(
        rpc({ theme: 'dark' }, { methods: ['PATCH', 'GET', 'PUT'] }).methods,
    ).toEqual(['GET', 'PATCH', 'PUT'])
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

// 16.111, 16.115 — A VALUE IS READ ALONE UNTIL `methods` NAMES ITS WRITES; then its `PUT` writes it and
// its `PATCH` applies a JSON Patch, each answering the value then held. THE REVERTS: answer `able`
// with no `methods` in `sourceVerbs`; the bare value's `PUT` and `PATCH` answer 200 and write it, where
// 405 is due. Give `rpc` no faces for a value's writes; the named ones answer 405.
test("a value's PUT writes it and its PATCH patches it where methods names them, each answering the value — 16.111, 16.115", async () => {
    const settings = rpc(
        { theme: 'dark', seats: 40 },
        { methods: ['GET', 'PUT', 'PATCH'] },
    )
    const plan = rpc({ tier: 'free' })
    await using app = await inMemoryApp({
        'account/settings.server.ts': { default: settings },
        'account/plan.server.ts': { default: plan },
    })
    const send = async (method: string, body: unknown, at = 'settings') => {
        const answer = await app.fetch(
            new Request(`http://app.invalid/account/${at}`, {
                method,
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            }),
        )
        return `${answer.status} ${await answer.text()}`
    }
    expect(await send('PUT', { given: [{ theme: 'light', seats: 40 }] })).toBe(
        '200 {"theme":"light","seats":40}',
    )
    expect(
        await send('PATCH', {
            given: [],
            ops: [{ op: 'replace', path: '/seats', value: 45 }],
        }),
    ).toBe('200 {"theme":"light","seats":45}')
    expect(await settings()).toEqual({ theme: 'light', seats: 45 })
    expect(plan.methods).toEqual(['GET'])
    expect([
        (await send('PUT', { given: [{ tier: 'pro' }] }, 'plan')).slice(0, 3),
        (
            await send(
                'PATCH',
                {
                    given: [],
                    ops: [{ op: 'replace', path: '/tier', value: 'pro' }],
                },
                'plan',
            )
        ).slice(0, 3),
    ]).toEqual(['405', '405'])
    expect(await plan()).toEqual({ tier: 'free' })
})

// 16.116 — A BROWSER'S WRITE OF A VALUE IS SENT: `set` as a `PUT` of the value, `patch` as a `PATCH` of
// the ops it made. THE REVERT: skip `sendsMembers` in `wire`; nothing is sent.
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
        'PUT /account/seats {"given":[{"seats":41}]}',
        'PATCH /account/seats {"given":[],"ops":[{"op":"replace","path":"/seats","value":42}]}',
    ])
})
