// 20.1, 20.3, 38.63 — ONE PROJECTION FROM A HANDLER TO EVERY SURFACE (`surfaceOf`), and the shell's
// listing, completion and placeholders derived from it: pure, so asked directly rather than through a
// spawned shell (`shell.test.ts` drives the terminal-less loop end to end).

import { expect, test } from 'bun:test'
import { GET } from '#server'
import type { Mount, Mounted } from '#server/answerRpc.ts'
import {
    argsText,
    cliListing,
    completionOf,
    expectedAfter,
    handlersText,
    shellWords,
} from '#server/shell.ts'
import { surfaceOf } from '#server/surfaceOf.ts'

function row(path: string, rest: Partial<Mount> = {}): Mount {
    return {
        address: `/__abide/rpc/${path}`,
        method: 'GET',
        source: `server/rpc/${path.split('/')[0]}.ts`,
        name: path.split('/').at(-1) as string,
        ui: true,
        cli: true,
        description: undefined,
        copy: undefined,
        defaults: undefined,
        args: undefined,
        ...rest,
    }
}

const TABLE: Mount[] = [
    row('invoices/getInvoice', {
        description: 'One invoice.',
        args: {
            type: 'object',
            properties: {
                id: { type: 'integer' },
                status: { enum: ['open', 'paid'] },
                tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['id'],
        },
    }),
    row('invoices/listInvoices'),
    row('invoices/audit', { method: 'POST', cli: false }),
    row('chat/room', {
        method: 'SOCKET',
        address: '/__abide/socket/chat/room',
    }),
]

const plain = (_code: string, text: string): string => text

// 20.3, 38.63 — A ROW WITHHOLDING ITSELF FROM THE COMMAND LINE IS NOT LISTED, COMPLETED OR SUGGESTED,
// and a socket is no surface's. THE REVERT: drop the `clients[surface] === false` test in `surfaceOf`;
// `invoices/audit` is listed and completed, and this reads three paths.
test('the shell lists and completes no handler whose clients.cli is false — 20.3, 38.63', () => {
    const listed = cliListing(TABLE)
    expect(listed.map((one) => one.path)).toEqual([
        'invoices/getInvoice',
        'invoices/listInvoices',
    ])
    expect(handlersText(listed, plain)).not.toContain('audit')
    const words = shellWords(false)
    expect(completionOf('call invoices/', words, listed).hits).toEqual([
        'invoices/getInvoice',
        'invoices/listInvoices',
    ])
    expect(completionOf('call invoices/a', words, listed).hits).toEqual([])
})

// 20.1, 20.11 — A MOUNTED HANDLER IS READ OFF THE HANDLER: its runtime `clients` and `description`,
// and the schema probed at mount, where a row is read off what the build wrote. THE REVERT: read
// `clients` off the row for a mounted handler too; `hidden` is published to MCP.
test('a mounted handler is projected off the handler, a row off the build — 20.1, 20.11', () => {
    const hidden = GET(() => 'secret', {
        description: 'At run time.',
        clients: { mcp: false },
    })
    const mounted: Mounted = {
        ...row('invoices/hidden', { description: 'Read by the build.' }),
        method: 'GET',
        handler: hidden as Mounted['handler'],
        argsDocument: { type: 'object' },
        wireArgs: undefined,
    }
    expect(surfaceOf(mounted, 'mcp')).toBeUndefined()
    expect(surfaceOf(mounted, 'openapi')).toEqual({
        address: '/__abide/rpc/invoices/hidden',
        method: 'GET',
        path: 'invoices/hidden',
        description: 'At run time.',
        schema: { type: 'object' },
    })
    expect(surfaceOf(TABLE[0] as Mount, 'openapi')?.description).toBe(
        'One invoice.',
    )
    expect(surfaceOf(row('pay', { method: 'POST' }), 'mcp')?.method).toBe(
        'POST',
    )
})

// 38.63 — A HANDLER'S ARGS AS THEY ARE TYPED: required bare, optional bracketed, an enum as its
// members, a list with `…`, and the JSON object where a `name=value` word cannot spell one.
test("the shell types a handler's args as its schema declares them — 38.63", () => {
    expect(argsText(TABLE[0]?.args)).toBe(
        'id=<number> [status=open|paid] [tags=<string>…]',
    )
    expect(argsText(undefined)).toBe('no args')
    expect(
        argsText({
            type: 'object',
            properties: {
                where: {
                    type: 'object',
                    properties: { city: { type: ['string', 'null'] } },
                },
            },
        }),
    ).toBe('{"where"?: {"city"?: string | null}}')
})

// 38.7 — WHAT A LINE EXPECTS NEXT: a handler's args once its address is typed, an arg's value once its
// name is, and nothing for args already given.
test('the shell suggests what a line expects next — 38.7', () => {
    const listed = cliListing(TABLE)
    const words = shellWords(false)
    const getInvoice = listed[0]
    expect(expectedAfter('call invoices/getInvoice', words, getInvoice)).toBe(
        ' id=<number> [status=open|paid] [tags=<string>…]',
    )
    expect(
        expectedAfter('call invoices/getInvoice status=', words, getInvoice),
    ).toBe('open|paid')
    expect(
        expectedAfter('call invoices/getInvoice id=4', words, getInvoice),
    ).toBe('')
    expect(
        completionOf('call invoices/getInvoice id=4 ', words, listed).hits,
    ).toEqual(['status=', 'tags='])
    expect(expectedAfter('call', words, undefined)).toBe(' <address> [args]')
})
