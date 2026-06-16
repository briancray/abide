import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { dispatchMcpRequest } from '../src/lib/mcp/dispatchMcpRequest.ts'
import { json } from '../src/lib/server/json.ts'
import { request } from '../src/lib/server/request.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { requestContext } from '../src/lib/server/runtime/requestContext.ts'
import { cache } from '../src/lib/shared/cache.ts'
import { cacheStoreSlot } from '../src/lib/shared/cacheStoreSlot.ts'
import { testSchema } from './standardSchema.ts'

const serverInfo = { name: 'test-app', version: '1.0.0' }

type Envelope = { result?: Record<string, unknown>; error?: { message: string } }

// Drives a tools/call envelope through the dispatcher and returns the raw envelope.
async function callTool(name: string, args?: Record<string, unknown>): Promise<Envelope> {
    const req = new Request('http://localhost/__abide/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name, arguments: args },
        }),
    })
    return (await dispatchMcpRequest(req, {}, serverInfo)) as Envelope
}

/*
MCP tool dispatch runs inside the request scope, so request-scoped helpers
behave as they do over HTTP rather than throwing (cookies/request) or sharing a
process-wide cache (the bug before dispatch was scoped).
*/
describe('MCP tool dispatch request scope', () => {
    // The server entry registers this resolver at boot; without it cache() falls
    // back to a module singleton and per-call isolation can't be observed.
    beforeAll(() => {
        cacheStoreSlot.resolver = () => requestContext.getStore()?.cache
    })
    afterAll(() => {
        cacheStoreSlot.resolver = undefined
    })

    test('cache() is isolated per tool call — each call recomputes', async () => {
        let runs = 0
        const producer = defineVerb('GET', '/rpc/mcp-scope-inner', () => json({ runs: ++runs }))
        defineVerb('GET', '/rpc/mcp-scope-cached', async () => json(await cache(producer)()), {
            inputSchema: testSchema(),
        })

        const first = await callTool('mcp-scope-cached')
        const second = await callTool('mcp-scope-cached')

        // Fresh store per call → the inner producer runs again, not memoised globally.
        expect(first.result?.structuredContent).toEqual({ runs: 1 })
        expect(second.result?.structuredContent).toEqual({ runs: 2 })
    })

    test('request() resolves instead of throwing', async () => {
        defineVerb(
            'GET',
            '/rpc/mcp-scope-host',
            () => json({ host: new URL(request().url).host }),
            {
                inputSchema: testSchema(),
            },
        )

        const envelope = await callTool('mcp-scope-host')
        expect(envelope.error).toBeUndefined()
        expect(envelope.result?.structuredContent).toEqual({ host: 'localhost' })
    })

    test('a thrown handler becomes an isError result, not a JSON-RPC error', async () => {
        defineVerb(
            'GET',
            '/rpc/mcp-scope-boom',
            () => {
                throw new Error('kaboom')
            },
            { inputSchema: testSchema() },
        )

        const envelope = await callTool('mcp-scope-boom')
        // Caught by the scope and framed as a tool-level error, not a -32603 envelope.
        expect(envelope.error).toBeUndefined()
        expect(envelope.result?.isError).toBe(true)
    })
})
