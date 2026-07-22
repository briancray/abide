// Response-header hardening — baseline security headers, the default cache posture, CORS (the
// `crossOrigin` opt-in), the required `Allow` on a 405, and SSE stream headers.

import { afterEach, describe, expect, test } from 'bun:test'
import { createTestApp } from '../test/createTestApp.ts'
import { GET } from './GET.ts'
import { POST } from './POST.ts'
import { sse } from './sse.ts'

const argsQuery = (value: unknown) => `?args=${encodeURIComponent(JSON.stringify(value))}`

describe('baseline hardening', () => {
    test('an RPC read carries nosniff + the private/no-cache default + Vary: Cookie', async () => {
        const app = await createTestApp({ routes: { ping: GET(() => ({ ok: true })) } })
        try {
            const response = await app.fetch(`/__abide/rpc/ping${argsQuery({})}`)
            expect(response.headers.get('x-content-type-options')).toBe('nosniff')
            expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
            expect(response.headers.get('cache-control')).toBe('private, no-cache')
            expect((response.headers.get('vary') ?? '').toLowerCase()).toContain('cookie')
            await response.text()
        } finally {
            await app.stop()
        }
    })

    test('an SSR HTML page carries X-Frame-Options SAMEORIGIN', async () => {
        const app = await createTestApp({ pages: { '/': '<h1>hi</h1>' } })
        try {
            const response = await app.fetch('/')
            expect(response.headers.get('content-type')).toContain('text/html')
            expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
            expect(response.headers.get('x-content-type-options')).toBe('nosniff')
            await response.text()
        } finally {
            await app.stop()
        }
    })
})

describe('405 Allow', () => {
    test('a GET to the POST-only MCP endpoint returns 405 with an Allow header', async () => {
        const app = await createTestApp({ routes: {} })
        try {
            const response = await app.fetch('/__abide/mcp', { method: 'GET' })
            expect(response.status).toBe(405)
            expect(response.headers.get('allow')).toBe('POST')
            await response.text()
        } finally {
            await app.stop()
        }
    })
})

describe('SSE stream headers', () => {
    test('an sse() stream is no-cache and disables proxy buffering', () => {
        const response = sse(
            (async function* () {
                yield 1
            })(),
        )
        expect(response.headers.get('content-type')).toBe('text/event-stream')
        expect(response.headers.get('cache-control')).toBe('no-cache')
        expect(response.headers.get('x-accel-buffering')).toBe('no')
    })
})

describe('CORS via crossOrigin', () => {
    const FOREIGN = 'https://foreign.example'

    afterEach(() => {
        delete Bun.env.APP_URL
    })

    test('a crossOrigin RPC answers the OPTIONS preflight and stamps the actual read', async () => {
        const app = await createTestApp({
            routes: { open: GET(() => ({ ok: true }), { crossOrigin: true }) },
        })
        try {
            const preflight = await app.fetch('/__abide/rpc/open', {
                method: 'OPTIONS',
                headers: { origin: FOREIGN, 'access-control-request-method': 'GET' },
            })
            expect(preflight.status).toBe(204)
            expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
            expect(preflight.headers.get('access-control-allow-methods')).toContain('GET')

            const read = await app.fetch(`/__abide/rpc/open${argsQuery({})}`, {
                headers: { origin: FOREIGN },
            })
            expect(read.headers.get('access-control-allow-origin')).toBe('*')
            await read.text()
        } finally {
            await app.stop()
        }
    })

    test('an OPTIONS to a same-origin-only RPC is 405 with Allow (no CORS)', async () => {
        const app = await createTestApp({ routes: { closed: GET(() => ({ ok: true })) } })
        try {
            const response = await app.fetch('/__abide/rpc/closed', {
                method: 'OPTIONS',
                headers: { origin: FOREIGN },
            })
            expect(response.status).toBe(405)
            expect(response.headers.get('allow')).toContain('GET')
            expect(response.headers.get('access-control-allow-origin')).toBeNull()
            await response.text()
        } finally {
            await app.stop()
        }
    })

    test('a foreign-origin mutation is CSRF-rejected unless crossOrigin admits the origin', async () => {
        Bun.env.APP_URL = 'https://app.example'
        const closedApp = await createTestApp({
            routes: { save: POST(() => ({ ok: true })) },
        })
        try {
            const rejected = await closedApp.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: { origin: FOREIGN, 'content-type': 'application/json' },
                body: '{}',
            })
            expect(rejected.status).toBe(403)
            await rejected.text()
        } finally {
            await closedApp.stop()
        }

        const openApp = await createTestApp({
            routes: { save: POST(() => ({ ok: true }), { crossOrigin: { origin: FOREIGN } }) },
        })
        try {
            const allowed = await openApp.fetch('/__abide/rpc/save', {
                method: 'POST',
                headers: { origin: FOREIGN, 'content-type': 'application/json' },
                body: '{}',
            })
            expect(allowed.status).toBe(200)
            expect(allowed.headers.get('access-control-allow-origin')).toBe(FOREIGN)
            expect((allowed.headers.get('vary') ?? '').toLowerCase()).toContain('origin')
            await allowed.text()
        } finally {
            await openApp.stop()
        }
    })
})
