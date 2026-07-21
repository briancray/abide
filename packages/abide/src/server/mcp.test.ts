// MCP server (machine-surfaces.md MS2) — JSON-RPC 2.0 over HTTP POST at `/__abide/mcp`. Exercises
// initialize / tools/list / tools/call end-to-end through the live route via createTestApp.

import { expect, test } from 'bun:test'
import type { JSONSchema } from '../shared/internal/jsonSchema.ts'
import { createTestApp, type TestApp, type TestAppConfig } from '../test/createTestApp.ts'
import { GET } from './GET.ts'
import { POST } from './POST.ts'
import { socket } from './socket.ts'

const searchInput: JSONSchema = {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
}

function fixtureConfig(): TestAppConfig {
    return {
        routes: {
            search: GET(async (args: { q: string }) => ({ hits: [args.q] }), {
                schemas: { input: searchInput },
                doc: 'Search the index',
            }),
            create: POST(async (args: { title: string }) => ({ id: 1, title: args.title }), {
                schemas: {
                    input: {
                        type: 'object',
                        properties: { title: { type: 'string' } },
                        required: ['title'],
                    },
                },
            }),
            hidden: GET(async () => ({ ok: true }), { clients: { mcp: false } }),
        },
        sockets: {
            ticks: socket<number>({ tail: 8, clientPublish: true }),
        },
    }
}

// biome-ignore lint/suspicious/noExplicitAny: dynamic JSON-RPC reply shape asserted per-test
async function mcp(app: TestApp, message: unknown): Promise<any> {
    const response = await app.fetch('/__abide/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
    })
    return response.json()
}

test('initialize returns protocol version, tools capability, and serverInfo', async () => {
    const app = createTestApp(fixtureConfig())
    try {
        const reply = await mcp(app, { jsonrpc: '2.0', id: 1, method: 'initialize' })
        expect(reply.jsonrpc).toBe('2.0')
        expect(reply.id).toBe(1)
        expect(reply.result.protocolVersion).toBeString()
        expect(reply.result.capabilities.tools).toBeDefined()
        expect(reply.result.serverInfo).toEqual({ name: 'abide', version: expect.any(String) })
    } finally {
        await app.stop()
    }
})

test('tools/list projects rpcs and socket tail/publish tools; honours clients.mcp:false', async () => {
    const app = createTestApp(fixtureConfig())
    try {
        const reply = await mcp(app, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
        // biome-ignore lint/suspicious/noExplicitAny: dynamic MCP tool objects from an any-typed JSON-RPC reply
        const tools: any[] = reply.result.tools
        const byName = new Map(tools.map((tool) => [tool.name, tool]))

        const search = byName.get('search')
        expect(search).toBeDefined()
        expect(search.inputSchema).toEqual(searchInput)
        expect(search.annotations.readOnlyHint).toBe(true)
        expect(search.description).toBe('Search the index')

        const create = byName.get('create')
        expect(create.annotations.readOnlyHint).toBe(false)

        // Socket tail + publish tools.
        expect(byName.has('ticks_tail')).toBe(true)
        expect(byName.get('ticks_tail').annotations.readOnlyHint).toBe(true)
        expect(byName.has('ticks_publish')).toBe(true)

        // clients.mcp:false is curated out.
        expect(byName.has('hidden')).toBe(false)
    } finally {
        await app.stop()
    }
})

test('tools/call on a read rpc returns the handler result as text content', async () => {
    const app = createTestApp(fixtureConfig())
    try {
        const reply = await mcp(app, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'search', arguments: { q: 'abide' } },
        })
        expect(reply.error).toBeUndefined()
        const content = reply.result.content
        expect(content[0].type).toBe('text')
        expect(JSON.parse(content[0].text)).toEqual({ hits: ['abide'] })
    } finally {
        await app.stop()
    }
})

test('tools/call on a mutation rpc runs the handler through the middleware chain', async () => {
    const app = createTestApp(fixtureConfig())
    try {
        const reply = await mcp(app, {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'create', arguments: { title: 'hi' } },
        })
        expect(reply.error).toBeUndefined()
        expect(JSON.parse(reply.result.content[0].text)).toEqual({ id: 1, title: 'hi' })
    } finally {
        await app.stop()
    }
})

test('socket tail tool returns the current tail buffer snapshot', async () => {
    const config = fixtureConfig()
    const sockets = config.sockets
    if (sockets === undefined) throw new Error('expected sockets config')
    const ticks = sockets.ticks
    if (ticks === undefined) throw new Error('expected ticks socket')
    ticks.publish(41)
    ticks.publish(42)
    const app = createTestApp(config)
    try {
        const reply = await mcp(app, {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: { name: 'ticks_tail', arguments: {} },
        })
        expect(JSON.parse(reply.result.content[0].text)).toEqual([41, 42])
    } finally {
        await app.stop()
    }
})

test('tools/call on an unknown tool yields a JSON-RPC error', async () => {
    const app = createTestApp(fixtureConfig())
    try {
        const reply = await mcp(app, {
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: { name: 'nope', arguments: {} },
        })
        expect(reply.result).toBeUndefined()
        expect(reply.error).toBeDefined()
        expect(reply.error.code).toBeNumber()
    } finally {
        await app.stop()
    }
})

test('an unknown method yields a JSON-RPC method-not-found error', async () => {
    const app = createTestApp(fixtureConfig())
    try {
        const reply = await mcp(app, { jsonrpc: '2.0', id: 7, method: 'bogus/method' })
        expect(reply.error.code).toBe(-32601)
    } finally {
        await app.stop()
    }
})
