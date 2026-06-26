import { describe, expect, test } from 'bun:test'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import { rpcRegistry } from '../src/lib/server/rpc/rpcRegistry.ts'
import { testSchema } from './standardSchema.ts'

describe('defineRpc happy path', () => {
    test('GET with schema is callable and auto-exposed to mcp + cli', async () => {
        const getUser = defineRpc<{ id: string }, { id: string }>(
            'GET',
            '/rpc/get-user',
            ({ id }) => json({ id }),
            { inputSchema: testSchema({ type: 'object', properties: { id: { type: 'string' } } }) },
        )
        expect(getUser.method).toBe('GET')
        expect(getUser.clients).toEqual({ browser: true, mcp: true, cli: true })
        expect(await getUser({ id: '42' })).toEqual({ id: '42' })

        const response = await getUser.raw({ id: '42' })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ id: '42' })

        expect(rpcRegistry.get('/rpc/get-user')?.clients.mcp).toBe(true)
    })

    test('mutating verbs are gated from mcp but stay on cli', () => {
        const create = defineRpc('POST', '/rpc/make-thing', () => json({ ok: true }), {
            inputSchema: testSchema(),
        })
        expect(create.clients).toEqual({ browser: true, mcp: false, cli: true })

        const remove = defineRpc('DELETE', '/rpc/drop-thing', () => json({ ok: true }), {
            inputSchema: testSchema(),
        })
        expect(remove.clients.mcp).toBe(false)
        expect(remove.clients.cli).toBe(true)
    })

    test('explicit clients.mcp opts a mutation back in', () => {
        const create = defineRpc('POST', '/rpc/opt-in', () => json({ ok: true }), {
            inputSchema: testSchema(),
            clients: { mcp: true },
        })
        expect(create.clients.mcp).toBe(true)
    })

    test('no-input verb is callable with zero args; required args stay required', async () => {
        const ping = defineRpc<undefined, { ok: boolean }>('GET', '/rpc/ping', () =>
            json({ ok: true }),
        )
        expect(await ping()).toEqual({ ok: true })
        expect((await ping.raw()).status).toBe(200)

        const search = defineRpc<{ q: string }, { q: string }>(
            'GET',
            '/rpc/search-typed',
            ({ q }) => json({ q }),
        )
        // type-level only: Args without undefined keeps the parameter required
        void (() => {
            // @ts-expect-error — dropping required args must not typecheck
            return search()
        })
    })

    test('schemaless verb is browser-only', () => {
        const bare = defineRpc('GET', '/rpc/bare', () => json({ ok: true }))
        expect(bare.clients).toEqual({ browser: true, mcp: false, cli: false })
    })

    test('output schema is recorded on the registry entry', () => {
        const outputSchema = testSchema({ type: 'object', properties: { id: { type: 'string' } } })
        defineRpc('GET', '/rpc/with-output', () => json({ id: '1' }), {
            inputSchema: testSchema(),
            outputSchema,
        })
        expect(rpcRegistry.get('/rpc/with-output')?.outputSchema).toBe(outputSchema)
    })
})
