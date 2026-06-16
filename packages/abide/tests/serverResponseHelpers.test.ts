import { describe, expect, test } from 'bun:test'
import { DELETE } from '../src/lib/server/DELETE.ts'
import { error } from '../src/lib/server/error.ts'
import { GET } from '../src/lib/server/GET.ts'
import { HEAD } from '../src/lib/server/HEAD.ts'
import { json } from '../src/lib/server/json.ts'
import { jsonl } from '../src/lib/server/jsonl.ts'
import { PATCH } from '../src/lib/server/PATCH.ts'
import { POST } from '../src/lib/server/POST.ts'
import { PUT } from '../src/lib/server/PUT.ts'
import { redirect } from '../src/lib/server/redirect.ts'
import { request } from '../src/lib/server/request.ts'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'
import { socket } from '../src/lib/server/socket.ts'
import { sse } from '../src/lib/server/sse.ts'
import { decodeResponse } from '../src/lib/shared/decodeResponse.ts'
import { HttpError } from '../src/lib/shared/HttpError.ts'

describe('json', () => {
    test('serializes the body with no-store by default', async () => {
        const response = json({ id: '7' })
        expect(response.status).toBe(200)
        expect(response.headers.get('Content-Type')).toContain('application/json')
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await response.json()).toEqual({ id: '7' })
    })

    test('caller init overrides cache-control and sets status', async () => {
        const response = json(
            { ok: true },
            { status: 201, headers: { 'Cache-Control': 'max-age=60' } },
        )
        expect(response.status).toBe(201)
        expect(response.headers.get('Cache-Control')).toBe('max-age=60')
    })

    test('undefined becomes 204 No Content and decodes back to undefined', async () => {
        const response = json(undefined)
        expect(response.status).toBe(204)
        expect(response.body).toBeNull()
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await decodeResponse(response)).toBeUndefined()
    })

    test('204 for undefined wins over init.status', () => {
        expect(json(undefined, { status: 200 }).status).toBe(204)
    })

    test('null stays a JSON null body, distinct from undefined', async () => {
        const response = json(null)
        expect(response.status).toBe(200)
        expect(await decodeResponse(response)).toBeNull()
    })
})

describe('error', () => {
    test('carries the explicit message verbatim as text/plain', async () => {
        const response = error(404, 'order not found')
        expect(response.status).toBe(404)
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(await response.text()).toBe('order not found')
    })

    test('defaults the body to the standard reason phrase', async () => {
        expect(await error(404).text()).toBe('Not Found')
    })

    test('falls back to HTTP <status> for an unlisted code', async () => {
        expect(await error(418).text()).toBe('HTTP 418')
    })

    test('positional status wins over init.status and init adds headers', () => {
        const response = error(429, 'slow down', {
            status: 200,
            headers: { 'Retry-After': '30' },
        })
        expect(response.status).toBe(429)
        expect(response.headers.get('Retry-After')).toBe('30')
    })
})

describe('redirect', () => {
    test('accepts a relative URL and defaults to 302', () => {
        const response = redirect('/login')
        expect(response.status).toBe(302)
        expect(response.headers.get('Location')).toBe('/login')
        expect(response.headers.get('Cache-Control')).toBe('no-store')
    })

    test('positional status wins over init.status', () => {
        const response = redirect('/articles/1', 301, { status: 302 })
        expect(response.status).toBe(301)
        expect(response.headers.get('Location')).toBe('/articles/1')
    })
})

describe('jsonl', () => {
    test('streams one JSON value per newline-terminated line', async () => {
        async function* frames() {
            yield { n: 1 }
            yield { n: 2 }
        }
        const response = jsonl(frames())
        expect(response.headers.get('Content-Type')).toBe('application/jsonl; charset=utf-8')
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
        expect(await response.text()).toBe('{"n":1}\n{"n":2}\n')
    })

    test('emits a final $error line when the generator throws', async () => {
        async function* frames() {
            yield { n: 1 }
            throw new Error('boom')
        }
        const body = await jsonl(frames()).text()
        expect(body).toBe('{"n":1}\n{"$error":"boom"}\n')
    })
})

describe('sse', () => {
    test('streams each frame as a data event', async () => {
        async function* frames() {
            yield { n: 1 }
            yield { n: 2 }
        }
        const response = sse(frames())
        expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8')
        expect(response.headers.get('Connection')).toBe('keep-alive')
        expect(await response.text()).toBe('data: {"n":1}\n\ndata: {"n":2}\n\n')
    })

    test('emits an event: error frame when the generator throws', async () => {
        async function* frames() {
            yield { n: 1 }
            throw new Error('boom')
        }
        const body = await sse(frames()).text()
        expect(body).toBe('data: {"n":1}\n\nevent: error\ndata: {"message":"boom"}\n\n')
    })
})

describe('request', () => {
    test('returns the inbound Request inside a request scope', async () => {
        const inbound = new Request('https://test.local/orders?id=1')
        const seen = await runWithRequestScope(inbound, { logRequests: false }, async () =>
            json(request().url),
        )
        expect(await seen.json()).toBe('https://test.local/orders?id=1')
    })

    test('throws when called outside a request scope', () => {
        expect(() => request()).toThrow('outside a request scope')
    })
})

describe('HttpError', () => {
    test('wraps a non-2xx Response and exposes its status', () => {
        const response = error(404, 'order not found')
        const httpError = new HttpError(response)
        expect(httpError).toBeInstanceOf(Error)
        expect(httpError.name).toBe('HttpError')
        expect(httpError.status).toBe(404)
        expect(httpError.response).toBe(response)
        expect(httpError.message).toBe('HTTP 404 error')
    })
})

/*
The verb and socket helpers are placeholders rewritten by the bundler; a
direct call means the file wasn't processed, so each throws guidance instead
of returning undefined.
*/
describe('bundler-rewritten helpers throw when called directly', () => {
    test.each([
        ['GET', GET],
        ['POST', POST],
        ['PUT', PUT],
        ['PATCH', PATCH],
        ['DELETE', DELETE],
        ['HEAD', HEAD],
    ])('%s verb helper throws outside an $rpc module', (_name, verb) => {
        expect(() => verb(() => json({}))).toThrow('outside an $rpc module')
    })

    test('socket helper throws outside an $sockets module', () => {
        expect(() => socket()).toThrow('outside an $sockets module')
    })
})
