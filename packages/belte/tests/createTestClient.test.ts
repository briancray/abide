import { beforeEach, describe, expect, test } from 'bun:test'
import { cookies } from '../src/lib/server/cookies.ts'
import { json } from '../src/lib/server/json.ts'
import { request } from '../src/lib/server/request.ts'
import { defineVerb } from '../src/lib/server/rpc/defineVerb.ts'
import { clearVerbRegistry } from '../src/lib/test/clearVerbRegistry.ts'
import { createTestClient } from '../src/lib/test/createTestClient.ts'
import { testSchema } from './standardSchema.ts'

describe('createTestClient', () => {
    beforeEach(() => clearVerbRegistry())

    test('plain call decodes the body; .raw returns the Response', async () => {
        defineVerb('GET', '/rpc/ping', ({ n }: { n?: string }) => json({ pong: n ?? '0' }), {
            inputSchema: testSchema({ type: 'object', properties: { n: { type: 'string' } } }),
        })
        const client = createTestClient()

        expect(await client.ping({ n: '5' })).toEqual({ pong: '5' })

        const response = await client.ping.raw({ n: '5' })
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ pong: '5' })
    })

    test('runs inside a request scope — request() resolves to the synthetic Request', async () => {
        defineVerb('GET', '/rpc/whereami', () => json({ host: new URL(request().url).host }))
        const client = createTestClient({ baseUrl: 'https://app.test/' })

        expect(await client.whereami()).toEqual({ host: 'app.test' })
    })

    test('injects headers so the handler reads inbound cookies', async () => {
        defineVerb('GET', '/rpc/whoami', () => json({ id: cookies().get('sid') ?? null }))
        const client = createTestClient({ headers: { cookie: 'sid=abc' } })

        expect(await client.whoami()).toEqual({ id: 'abc' })
    })

    test('flushes Set-Cookie the handler writes onto the .raw Response', async () => {
        defineVerb('POST', '/rpc/login', () => {
            cookies().set('session', 'tok', { httpOnly: true })
            return json({ ok: true })
        })
        const client = createTestClient()

        const response = await client.login.raw({})
        const setCookies = response.headers.getSetCookie()
        expect(setCookies.some((header) => header.startsWith('session=tok'))).toBe(true)
        expect(setCookies.some((header) => header.includes('HttpOnly'))).toBe(true)
    })

    test('a thrown handler hits app.handleError', async () => {
        defineVerb('GET', '/rpc/boom', () => {
            throw new Error('kaboom')
        })
        const client = createTestClient({
            app: { handleError: () => json({ caught: true }, { status: 503 }) },
        })

        const response = await client.boom.raw()
        expect(response.status).toBe(503)
        expect(await response.json()).toEqual({ caught: true })
    })

    test('a thrown handler with no app falls back to a 500', async () => {
        defineVerb('GET', '/rpc/boom', () => {
            throw new Error('kaboom')
        })
        const client = createTestClient()

        const response = await client.boom.raw()
        expect(response.status).toBe(500)
    })

    test('plain call throws on a non-2xx; .raw exposes the status', async () => {
        defineVerb('GET', '/rpc/missing', () => json({ error: 'nope' }, { status: 404 }))
        const client = createTestClient()

        expect(client.missing()).rejects.toThrow()
        expect((await client.missing.raw()).status).toBe(404)
    })

    test('returns undefined for an unknown command', () => {
        const client = createTestClient()
        expect(client.nope).toBeUndefined()
    })
})
