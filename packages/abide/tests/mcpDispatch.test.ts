import { beforeAll, describe, expect, test } from 'bun:test'
import { dispatchMcpRequest } from '../src/lib/mcp/dispatchMcpRequest.ts'
import { json } from '../src/lib/server/json.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { testSchema } from './standardSchema.ts'

const serverInfo = { name: 'test-app', version: '1.2.3' }

// Drives a JSON-RPC envelope through the MCP dispatcher and returns the result.
async function call(method: string, params?: unknown): Promise<Record<string, unknown>> {
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

type Tool = { name: string; annotations?: Record<string, boolean>; outputSchema?: unknown }
function findTool(tools: Tool[], name: string): Tool | undefined {
    return tools.find((tool) => tool.name === name)
}

describe('MCP dispatch happy path', () => {
    beforeAll(() => {
        defineVerb('GET', '/rpc/mcp-echo', ({ id }: { id: string }) => json({ id }), {
            inputSchema: testSchema({ type: 'object', properties: { id: { type: 'string' } } }),
            outputSchema: testSchema({ type: 'object', properties: { id: { type: 'string' } } }),
        })
        defineVerb('DELETE', '/rpc/mcp-remove', () => json({ ok: true }), {
            inputSchema: testSchema(),
            clients: { mcp: true },
        })
    })

    test('initialize advertises protocol, capabilities, and server info', async () => {
        const result = await call('initialize')
        expect(result.protocolVersion).toBeString()
        expect(result.serverInfo).toEqual(serverInfo)
        expect(result.capabilities).toMatchObject({ tools: { listChanged: false } })
    })

    test('ping resolves to an empty result', async () => {
        expect(await call('ping')).toEqual({})
    })

    test('tools/list carries verb-derived annotations and output schema', async () => {
        const { tools } = (await call('tools/list')) as { tools: Tool[] }
        const echo = findTool(tools, 'mcp-echo')
        expect(echo?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false })
        expect(echo?.outputSchema).toEqual({
            type: 'object',
            properties: { id: { type: 'string' } },
        })

        const remove = findTool(tools, 'mcp-remove')
        expect(remove?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true })
    })

    test('tools/call returns text + structuredContent for an object body', async () => {
        const result = await call('tools/call', { name: 'mcp-echo', arguments: { id: '42' } })
        expect(result.isError).toBeUndefined()
        expect(result.structuredContent).toEqual({ id: '42' })
        expect(result.content).toEqual([{ type: 'text', text: '{"id":"42"}' }])
    })
})
