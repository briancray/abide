import { beforeAll, describe, expect, test } from 'bun:test'
import { dispatchMcpRequest } from '../src/lib/mcp/dispatchMcpRequest.ts'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { createSocketDispatcher } from '../src/lib/server/sockets/createSocketDispatcher.ts'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import { testSchema } from './standardSchema.ts'
import { routesFor } from './support/routesFor.ts'

describe('socket REST happy path', () => {
    const chat = defineSocket<{ text: string }>('rest-chat', {
        schema: testSchema(),
        tail: 10,
        clientPublish: true,
    })
    const dispatcher = createSocketDispatcher(routesFor('rest-chat'))

    beforeAll(() => {
        chat.publish({ text: 'one' })
        chat.publish({ text: 'two' })
    })

    test('GET returns the retained tail snapshot as JSON', async () => {
        const response = await dispatcher.rest(
            new Request('http://x/__abide/sockets/rest-chat'),
            'rest-chat',
        )
        expect(response.headers.get('content-type')).toContain('application/json')
        expect(await response.json()).toEqual([{ text: 'one' }, { text: 'two' }])
    })

    test('GET ?tail=N caps the snapshot to the last N', async () => {
        const response = await dispatcher.rest(
            new Request('http://x/__abide/sockets/rest-chat?tail=1'),
            'rest-chat',
        )
        expect(await response.json()).toEqual([{ text: 'two' }])
    })

    test('GET with text/event-stream upgrades to an SSE stream', async () => {
        const response = await dispatcher.rest(
            new Request('http://x/__abide/sockets/rest-chat', {
                headers: { accept: 'text/event-stream' },
            }),
            'rest-chat',
        )
        expect(response.headers.get('content-type')).toContain('text/event-stream')
        await response.body?.cancel()
    })

    test('POST publishes the JSON body', async () => {
        const response = await dispatcher.rest(
            new Request('http://x/__abide/sockets/rest-chat', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ text: 'three' }),
            }),
            'rest-chat',
        )
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
    })

    test('POST to a non-clientPublish socket is rejected with 403', async () => {
        defineSocket('rest-readonly', { schema: testSchema(), tail: 5 })
        const readonly = createSocketDispatcher(routesFor('rest-readonly'))
        const response = await readonly.rest(
            new Request('http://x/__abide/sockets/rest-readonly', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ x: 1 }),
            }),
            'rest-readonly',
        )
        expect(response.status).toBe(403)
    })
})

const serverInfo = { name: 'test-app', version: '1.0.0' }

async function mcpCall(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const request = new Request('http://localhost/__abide/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const envelope = (await dispatchMcpRequest(request, {}, serverInfo)) as {
        result?: Record<string, unknown>
        error?: unknown
    }
    expect(envelope.error).toBeUndefined()
    return envelope.result as Record<string, unknown>
}

describe('socket MCP tools happy path', () => {
    beforeAll(() => {
        const room = defineSocket<{ text: string }>('mcp-room', {
            schema: testSchema(),
            tail: 10,
            clientPublish: true,
        })
        room.publish({ text: 'seeded' })
    })

    test('tools/list exposes a read-only tail tool and a publish tool', async () => {
        const { tools } = (await mcpCall('tools/list')) as {
            tools: Array<{ name: string; annotations?: Record<string, boolean> }>
        }
        const tail = tools.find((tool) => tool.name === 'mcp-room-tail')
        const publish = tools.find((tool) => tool.name === 'mcp-room-publish')
        expect(tail?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
        expect(publish?.annotations).toMatchObject({ readOnlyHint: false })
    })

    test('tail tool returns recent frames as structuredContent', async () => {
        const result = await mcpCall('tools/call', {
            name: 'mcp-room-tail',
            arguments: { count: 1 },
        })
        expect(result.structuredContent).toEqual({ frames: [{ text: 'seeded' }] })
    })

    test('publish tool fans a message out, observable by a later tail', async () => {
        const published = await mcpCall('tools/call', {
            name: 'mcp-room-publish',
            arguments: { text: 'from-mcp' },
        })
        expect(published.isError).toBeUndefined()

        const tailed = (await mcpCall('tools/call', {
            name: 'mcp-room-tail',
            arguments: { count: 1 },
        })) as { structuredContent: { frames: Array<{ text: string }> } }
        expect(tailed.structuredContent.frames.at(-1)).toEqual({ text: 'from-mcp' })
    })
})

// Raw dispatch returning the whole envelope, for asserting error replies.
async function mcpEnvelope(
    method: string,
    params?: unknown,
): Promise<{ result?: Record<string, unknown>; error?: { message: string } }> {
    const request = new Request('http://localhost/__abide/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return (await dispatchMcpRequest(request, {}, serverInfo)) as {
        result?: Record<string, unknown>
        error?: { message: string }
    }
}

describe('MCP tool exposure', () => {
    beforeAll(() => {
        // Exposed socket whose tail tool name an mcp-unexposed rpc also maps to
        // (mutating rpcs default clients.mcp off).
        defineSocket<{ text: string }>('collide', { schema: testSchema(), tail: 5 })
        defineRpc('POST', '/collide-tail', () => json({ ok: true }), {
            schemas: { input: testSchema() },
        })
        defineRpc('POST', '/hidden-write', () => json({ ok: true }), {
            schemas: { input: testSchema() },
        })
    })

    test('a name no declaration exposes is rejected', async () => {
        const envelope = await mcpEnvelope('tools/call', { name: 'no-such-tool', arguments: {} })
        expect(envelope.error?.message).toBe('unknown tool: no-such-tool')
    })

    test("an mcp-unexposed rpc's command name is not callable", async () => {
        const envelope = await mcpEnvelope('tools/call', { name: 'hidden-write', arguments: {} })
        expect(envelope.error?.message).toBe('unknown tool: hidden-write')
    })

    test('an advertised socket tool stays callable when an unexposed rpc shares its name', async () => {
        const { tools } = (await mcpCall('tools/list')) as { tools: Array<{ name: string }> }
        expect(tools.map((tool) => tool.name)).toContain('collide-tail')
        const envelope = await mcpEnvelope('tools/call', { name: 'collide-tail', arguments: {} })
        expect(envelope.error).toBeUndefined()
        expect(envelope.result?.structuredContent).toEqual({ frames: [] })
    })
})
