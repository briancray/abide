// 16.23, 16.56, 20.10, 42.12 — WHAT AN `App` DOES WITH A CALL, held in this process over
// modules already loaded (`inMemoryApp.ts`): the same `bootApp` and `appSources` every command boots
// through, with no `abide build` and no child process ahead of it.

import { afterAll, expect, test } from 'bun:test'

import { GET, jsonSchema, POST, reactive, refuse, request } from '#server'
import { config } from '#server/config.ts'
import type { McpSurface } from '#server/generatedSurfaces.ts'
import { currentRequestScope, LISTENING } from '#server/requestScope.ts'

import { inMemoryApp } from './inMemoryApp.ts'

const RPC = '/invoices'

// Each a handler file's module, by its path (`inMemoryApp.ts`).
const INVOICES = {
    'invoices/getInvoice.handler.ts': {
        default: GET(
            reactive(
                async ({ id }: { id: number }) => ({ id, total: id * 10 }),
                {
                    args: jsonSchema<{ id: number }>({
                        type: 'object',
                        properties: { id: { type: 'integer' } },
                        required: ['id'],
                    }),
                },
            ),
        ),
    },
    'invoices/untimed.handler.ts': { default: GET(() => 1) },
    'invoices/endless.handler.ts': {
        default: GET(() => 1, { timeout: Infinity }),
    },
    'invoices/settle.handler.ts': {
        default: POST(({ id }: { id: number }) => id),
    },
}

afterAll(() => {
    LISTENING.server = undefined
})

// 16.23, 16.56 — WHAT A CALL DOES TO THE REQUEST'S IDLE TIMEOUT, read off a recording server: off
// once the request is received whole and back to bun's ten seconds once it is answered, whatever
// `timeout` the handler names, and for a body read as for none. In process, because the idle timeout
// a socket was given is not observable from the far end short of waiting it out (`idleTimeout.test.ts`
// does). THE REVERT: drop the restore in `releaseScope`; every call reads `[0]`.
test('a call is never reaped while answered, and reaped once idle again — 16.23, 16.56', async () => {
    const set: Record<string, number[]> = {}
    const answered: Record<string, number> = {}
    let calling = ''
    LISTENING.server = {
        timeout: (_request: Request, seconds: number) =>
            set[calling]?.push(seconds),
    } as never
    await using app = await inMemoryApp(INVOICES)
    for (const name of ['untimed', 'endless', 'settle']) {
        calling = name
        set[name] = []
        answered[name] = (
            await app.fetch(
                name === 'settle'
                    ? new Request(`http://app.test${RPC}/${name}`, {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: '{"id":1}',
                      })
                    : new Request(`http://app.test${RPC}/${name}`),
            )
        ).status
    }
    expect({ set, answered }).toEqual({
        set: {
            untimed: [0, 10],
            endless: [0, 10],
            settle: [0, 10],
        },
        answered: { untimed: 200, endless: 200, settle: 200 },
    })
})

// 20.10, 42.12 — AN MCP CALL IS ANSWERED BY THE APP IT WAS MADE TO, not by whichever `App` the process
// built last: two held in one process, the second stopped, and the first still answers its tools. THE
// REVERT: build the `McpSurface` in `bootApp` over `RPC_SERVER.raw` rather than the app's own `fetch`,
// and set that to `fetch` alone; the stopped app answers the call, and its text reads "the app is
// stopping".
test('an MCP call is answered by its own App, not the last one built — 20.10, 42.12', async () => {
    const modules = INVOICES
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

// 16.23, 16.10 — THE TIMEOUT IS SET ON THE REQUEST THE LISTENER RECEIVED. Under a mount the app
// answers a copy below it, and bun's `timeout` does nothing for a request it was not handed itself.
// THE REVERT: open the scope with the copy as its `received` in `App.fetch`; the recording server is
// handed the copy, and reads `[false, 0], [false, 10]`.
test('a call under a mount sets the idle timeout on the request the listener received — 16.23, 16.10', async () => {
    const received = new Request(`http://app.test/app${RPC}/untimed`)
    const set: [boolean, number][] = []
    LISTENING.server = {
        timeout: (request: Request, seconds: number) =>
            set.push([request === received, seconds]),
    } as never
    process.env.APP_URL = 'http://app.test/app'
    try {
        await using app = await inMemoryApp(INVOICES)
        const status = (await app.fetch(received)).status
        expect({ set, status }).toEqual({
            set: [
                [true, 0],
                [true, 10],
            ],
            status: 200,
        })
    } finally {
        delete process.env.APP_URL
        config.invalidate()
    }
})

const ASKED = {
    'asked/whoami.handler.ts': {
        default: POST(
            () => request().headers.get('authorization') ?? 'nobody',
            {
                description: 'Who is asking.',
            },
        ),
    },
    'asked/guarded.handler.ts': {
        default: POST(() => 'never', {
            description: 'Refused by its rung.',
            middleware: [async () => refuse(401, 'no')],
        }),
    },
}

// 20.9, 20.10, 44.7 — THE MCP SURFACE IN PROCESS, as a `Toolbox` holds it, with no JSON-RPC between: it
// lists what the endpoint lists, and a call is still a request through the app made as the asker, so
// the handler reads the asker's credentials and a rung refuses it as it would anyone. THE REVERTS: start
// `callOf`'s headers empty rather than from the asker's, and `whoami` reads "nobody"; answer a call
// off the handler's own function rather than through the app, and `guarded` is not refused.
test('the MCP surface lists and calls in process, as the asker — 20.9, 20.10, 44.7', async () => {
    await using app = await inMemoryApp(ASKED)
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
        content: [{ type: 'text', text: '"Bearer ada"' }],
        failed: false,
    })
    expect((await surface.call('post_asked_guarded', {}, asker)).failed).toBe(
        true,
    )
    expect(await surface.call('post_asked_missing', {}, asker)).toEqual({
        content: [{ type: 'text', text: 'No tool named post_asked_missing.' }],
        failed: true,
    })
})

// 30.3, 30.19, 15.8 — A TOOL CALL WHOSE PATH PARAMETER NO ADDRESS CAN CARRY IS A TOOL ERROR, the
// `ValidationError` the wire answers, rather than a JSON-RPC failure the app's `onError` hears. THE
// REVERT: drop the catch around `callOf` in `McpSurface.#called`; the call answers 500.
test('an MCP tool call missing a path parameter is a ValidationError tool result — 30.3, 15.8', async () => {
    await using app = await inMemoryApp({
        'comments/[id]/thread.handler.ts': {
            default: GET(({ id }: { id: string }) => [id]),
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
