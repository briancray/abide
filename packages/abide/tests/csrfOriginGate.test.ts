import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createMcpServer } from '../src/lib/mcp/createMcpServer.ts'
import { json } from '../src/lib/server/json.ts'
import { defineRpc } from '../src/lib/server/rpc/defineRpc.ts'
import type { RemoteRoutes } from '../src/lib/server/rpc/types/RemoteRoutes.ts'
import { defineSocket } from '../src/lib/server/sockets/defineSocket.ts'
import type { SocketRoutes } from '../src/lib/server/sockets/types/SocketRoutes.ts'
import { bootTestServer } from './support/bootTestServer.ts'

const createThing = defineRpc('POST', '/rpc/csrf-create', () => json({ created: true }))
const openMutation = defineRpc('POST', '/rpc/csrf-open', () => json({ created: true }), {
    crossOrigin: true,
})
const readThing = defineRpc('GET', '/rpc/csrf-read', () => json({ ok: true }))

const rpc: RemoteRoutes = {
    '/rpc/csrf-create': async () => ({ createThing }),
    '/rpc/csrf-open': async () => ({ openMutation }),
    '/rpc/csrf-read': async () => ({ readThing }),
}

/* A client-publishable socket — its REST POST face fans a message to subscribers.
   `clients: { cli: true }` keeps that REST face reachable: it's the CLI/MCP transport,
   gated to sockets exposed to a non-browser surface (a schemaless socket is browser-only). */
defineSocket<{ text: string }>('csrf-feed', {
    tail: 10,
    clientPublish: true,
    clients: { cli: true },
})
const sockets: SocketRoutes = { 'csrf-feed': () => Promise.resolve({}) as never }

/* The hostile-page shape: a cross-site form post carrying ambient cookies. */
function formPost(origin: string, path: string, headers: Record<string, string>) {
    return fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: 'title=pwned',
    })
}

/*
End-to-end CSRF posture: the real server refuses cross-site browser
mutations on rpc and MCP routes while leaving same-origin browsers and
Origin-less native clients (curl/CLI/MCP) untouched.
*/
describe('CSRF origin gate over HTTP', () => {
    let origin: string
    let stop: () => void

    beforeAll(async () => {
        const booted = await bootTestServer({ rpc, sockets, mcp: createMcpServer() })
        origin = booted.origin
        stop = booted.stop
    })
    afterAll(() => {
        stop()
    })

    test('cross-origin form post to a mutating rpc is refused with 403', async () => {
        const res = await formPost(origin, '/rpc/csrf-create', {
            origin: 'https://evil.example',
        })
        expect(res.status).toBe(403)
        expect(await res.text()).toContain('crossOrigin: true')
    })

    test('same-origin mutation passes', async () => {
        const res = await formPost(origin, '/rpc/csrf-create', { origin })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ created: true })
    })

    test('Origin-less mutation passes (curl/CLI shape)', async () => {
        const res = await formPost(origin, '/rpc/csrf-create', {})
        expect(res.status).toBe(200)
    })

    test('cross-origin read passes', async () => {
        const res = await fetch(`${origin}/rpc/csrf-read`, {
            headers: { origin: 'https://evil.example' },
        })
        expect(res.status).toBe(200)
    })

    test('crossOrigin: true opts a mutation out of the gate', async () => {
        const res = await formPost(origin, '/rpc/csrf-open', {
            origin: 'https://evil.example',
        })
        expect(res.status).toBe(200)
    })

    test('cross-origin post to the MCP endpoint is refused with 403', async () => {
        // The text/plain form trick: .json() ignores Content-Type, so without
        // the gate a hostile page could smuggle a JSON-RPC envelope here.
        const res = await fetch(`${origin}/__abide/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
        expect(res.status).toBe(403)
    })

    test('Origin-less MCP request passes (native MCP clients)', async () => {
        const res = await fetch(`${origin}/__abide/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        })
        expect(res.status).toBe(200)
    })

    test('cross-origin publish to a socket REST face is refused with 403', async () => {
        // The same text/plain trick: rest() reads req.json() ignoring Content-Type,
        // so without the gate a hostile page could publish to a clientPublish socket.
        const res = await fetch(`${origin}/__abide/sockets/csrf-feed`, {
            method: 'POST',
            headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
            body: JSON.stringify({ text: 'pwned' }),
        })
        expect(res.status).toBe(403)
    })

    test('same-origin socket publish passes', async () => {
        const res = await fetch(`${origin}/__abide/sockets/csrf-feed`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin },
            body: JSON.stringify({ text: 'hi' }),
        })
        expect(res.status).toBe(200)
    })

    test('cross-origin socket tail read passes (reads are safe)', async () => {
        const res = await fetch(`${origin}/__abide/sockets/csrf-feed`, {
            headers: { origin: 'https://evil.example' },
        })
        expect(res.status).toBe(200)
    })
})
