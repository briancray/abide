// 16.22, 16.56, 16.57, 20.10, 42.12 — WHAT AN `App` DOES WITH A CALL, held in this process over
// modules already loaded (`inMemoryApp.ts`): the same `bootApp` and `appSources` every command boots
// through, with no `abide build` and no child process ahead of it.

import { afterAll, expect, test } from 'bun:test'
import { GET, jsonSchema, POST, reactive, refuse, request } from '#server'
import { config } from '#server/config.ts'
import type { McpSurface } from '#server/generatedSurfaces.ts'
import { currentRequestScope, LISTENING } from '#server/requestScope.ts'
import { inMemoryApp } from './inMemoryApp.ts'

const RPC = '/invoices'

const INVOICES = {
    getInvoice: GET(
        reactive(async ({ id }: { id: number }) => ({ id, total: id * 10 }), {
            args: jsonSchema<{ id: number }>({
                type: 'object',
                properties: { id: { type: 'integer' } },
                required: ['id'],
            }),
        }),
    ),
    untimed: GET(() => 1),
    slow: GET(() => 1, { timeout: 40_000 }),
    endless: GET(() => 1, { timeout: Infinity }),
}

afterAll(() => {
    LISTENING.server = undefined
})

// 16.22, 16.56, 16.57 — WHAT A CALL RAISES THE REQUEST'S IDLE TIMEOUT TO, read off a recording server:
// nothing where no `timeout` is named, a socket tick past the seconds where one is (its refusal is
// written at the timeout, 16.68), and bun's 0 — never reaped — for
// `Infinity`. In process, because the idle timeout a socket was given is not observable from the
// far end short of waiting it out. THE REVERT: fall back to 30_000 for `ABIDE_RPC_TIMEOUT`; the
// untimed call raises to 30.
test('a call raises the idle timeout only as far as its timeout says — 16.56, 16.57', async () => {
    const raised: Record<string, number[]> = {}
    const answered: Record<string, number> = {}
    let calling = ''
    LISTENING.server = {
        timeout: (_request: Request, seconds: number) =>
            raised[calling]?.push(seconds),
    } as never
    await using app = await inMemoryApp({ 'invoices/invoices.abide': INVOICES })
    for (const name of ['untimed', 'slow', 'endless']) {
        calling = name
        raised[name] = []
        answered[name] = (
            await app.fetch(new Request(`http://app.test${RPC}/${name}`))
        ).status
    }
    expect({ raised, answered }).toEqual({
        raised: { untimed: [], slow: [44], endless: [0] },
        answered: { untimed: 200, slow: 200, endless: 200 },
    })
})

// 20.10, 42.12 — AN MCP CALL IS ANSWERED BY THE APP IT WAS MADE TO, not by whichever `App` the process
// built last: two held in one process, the second stopped, and the first still answers its tools. THE
// REVERT: build the `McpSurface` in `bootApp` over `RPC_SERVER.raw` rather than the app's own `fetch`,
// and set that to `fetch` alone; the stopped app answers the call, and its text reads "the app is
// stopping".
test('an MCP call is answered by its own App, not the last one built — 20.10, 42.12', async () => {
    const modules = { 'invoices/invoices.abide': INVOICES }
    await using first = await inMemoryApp(modules)
    const second = await inMemoryApp(modules)
    await second.stop()
    const answer = await first.fetch(
        new Request('http://app.test/__abide/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: {
                    name: 'get_invoices_getInvoice',
                    arguments: { id: 4 },
                },
            }),
        }),
    )
    const called = (
        (await answer.json()) as {
            result: { content: { text: string }[]; isError: boolean }
        }
    ).result
    expect(called.content[0]?.text).toBe('{"id":4,"total":40}')
    expect(called.isError).toBe(false)
})

// 16.22, 16.10 — THE TIMEOUT IS RAISED ON THE REQUEST THE LISTENER RECEIVED. Under a mount the app
// answers a copy below it, and bun's `timeout` does nothing for a request it was not handed itself.
// THE REVERT: raise it on the request `answerRpc` answers; the recording server is handed the copy,
// and reads `[false, 44]`.
test('a call under a mount raises the idle timeout on the request the listener received — 16.22, 16.10', async () => {
    const received = new Request(`http://app.test/app${RPC}/slow`)
    const raised: [boolean, number][] = []
    LISTENING.server = {
        timeout: (request: Request, seconds: number) =>
            raised.push([request === received, seconds]),
    } as never
    process.env.APP_URL = 'http://app.test/app'
    try {
        await using app = await inMemoryApp({
            'invoices/invoices.abide': INVOICES,
        })
        const status = (await app.fetch(received)).status
        expect({ raised, status }).toEqual({
            raised: [[true, 44]],
            status: 200,
        })
    } finally {
        delete process.env.APP_URL
        config.invalidate()
    }
})

const ASKED = {
    whoami: POST(() => request().headers.get('authorization') ?? 'nobody', {
        description: 'Who is asking.',
    }),
    guarded: POST(() => 'never', {
        description: 'Refused by its rung.',
        middleware: [async () => refuse(401, 'no')],
    }),
}

// 20.9, 20.10, 45.7 — THE MCP SURFACE IN PROCESS, as a `Toolbox` holds it, with no JSON-RPC between: it
// lists what the endpoint lists, and a call is still a request through the app made as the asker, so
// the handler reads the asker's credentials and a rung refuses it as it would anyone. THE REVERTS: start
// `callOf`'s headers empty rather than from the asker's, and `whoami` reads "nobody"; answer a call
// off the handler's own function rather than through the app, and `guarded` is not refused.
test('the MCP surface lists and calls in process, as the asker — 20.9, 20.10, 45.7', async () => {
    await using app = await inMemoryApp({ 'asked/asked.abide': ASKED })
    const surface = await app.run(
        () => currentRequestScope()?.app?.mcp as McpSurface,
    )
    const names = []
    for (const tool of surface.list()) names.push(tool.name)
    expect(names.sort()).toEqual(['post_asked_guarded', 'post_asked_whoami'])
    const asker = new Request('http://app.test/', {
        headers: { authorization: 'Bearer ada' },
    })
    expect(await surface.call('post_asked_whoami', {}, asker)).toEqual({
        text: '"Bearer ada"',
        failed: false,
    })
    expect((await surface.call('post_asked_guarded', {}, asker)).failed).toBe(
        true,
    )
    expect(await surface.call('post_asked_missing', {}, asker)).toEqual({
        text: 'No tool named post_asked_missing.',
        failed: true,
    })
})

// 30.3, 30.19, 15.8 — A TOOL CALL WHOSE PATH PARAMETER NO ADDRESS CAN CARRY IS A TOOL ERROR, the
// `ValidationError` the wire answers, rather than a JSON-RPC failure the app's `onError` hears. THE
// REVERT: drop the catch around `callOf` in `McpSurface.#called`; the call answers 500.
test('an MCP tool call missing a path parameter is a ValidationError tool result — 30.3, 15.8', async () => {
    await using app = await inMemoryApp({
        'comments/[id]/comments.abide': {
            thread: GET(({ id }: { id: string }) => [id]),
        },
    })
    const ask = async (method: string, params: unknown): Promise<Response> =>
        app.fetch(
            new Request('http://app.test/__abide/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            }),
        )
    const listed = (await (await ask('tools/list', {})).json()) as {
        result: { tools: { name: string }[] }
    }
    const name = listed.result.tools[0]?.name as string
    for (const id of [undefined, '', '..']) {
        const answer = await ask('tools/call', { name, arguments: { id } })
        expect(`${id}: ${answer.status}`).toBe(`${id}: 200`)
        const called = (
            (await answer.json()) as {
                result: { content: { text: string }[]; isError: boolean }
            }
        ).result
        expect(called.isError).toBe(true)
        const problem = JSON.parse(called.content[0]?.text as string)
        expect(`${problem.status} ${problem.type}`).toContain('422')
    }
})
