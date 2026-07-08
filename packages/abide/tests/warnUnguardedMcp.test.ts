import { describe, expect, spyOn, test } from 'bun:test'
import { createMcpServer } from '../src/lib/mcp/createMcpServer.ts'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { testSchema } from './standardSchema.ts'
import { bootTestServer } from './support/bootTestServer.ts'

/* A schema'd GET auto-exposes to MCP, so the boot below has ≥1 exposed tool. */
defineRpc('GET', '/rpc/warn-probe', () => json({ ok: true }), {
    schemas: { input: testSchema() },
})

/*
The unguarded-MCP boot warning: mounted MCP endpoint + exposed tools + no
app.handle middleware must announce itself; an app.handle (the blessed auth
seam) silences it without inspecting what the middleware does.
*/
describe('warnUnguardedMcp at boot', () => {
    test('warns when MCP is mounted with exposed tools and no app.handle', async () => {
        const warn = spyOn(console, 'warn')
        const booted = await bootTestServer({ mcp: createMcpServer() })
        booted.stop()
        const output = warn.mock.calls.flat().join('\n')
        warn.mockRestore()
        expect(output).toContain('/__abide/mcp')
        expect(output).toContain('app.handle')
    })

    test('stays silent when app.handle exists', async () => {
        const warn = spyOn(console, 'warn')
        const booted = await bootTestServer({
            mcp: createMcpServer(),
            app: { handle: (request, next) => next(request) },
        })
        booted.stop()
        const output = warn.mock.calls.flat().join('\n')
        warn.mockRestore()
        expect(output).not.toContain('/__abide/mcp')
    })

    test('stays silent when no MCP server is mounted', async () => {
        const warn = spyOn(console, 'warn')
        const booted = await bootTestServer({})
        booted.stop()
        const output = warn.mock.calls.flat().join('\n')
        warn.mockRestore()
        expect(output).not.toContain('/__abide/mcp')
    })
})
