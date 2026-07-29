import { describe, expect, test } from 'bun:test'
import { HttpError } from '../shared/HttpError.ts'
import { isTypedError } from '../shared/internal/isTypedError.ts'
import { Redirect } from '../shared/Redirect.ts'
import { error } from './error.ts'
import { errorResponse } from './internal/errorResponse.ts'
import { outcomeResponse } from './internal/outcomeResponse.ts'
import { json } from './json.ts'
import { jsonl } from './jsonl.ts'
import { redirect } from './redirect.ts'
import { sse } from './sse.ts'

// Drain a streaming response body to a single decoded string, proving the ReadableStream
// path runs to completion.
async function drain(response: Response): Promise<string> {
    const body = response.body
    if (body === null) throw new Error('expected a streaming response body')
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let out = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        out += decoder.decode(value, { stream: true })
    }
    out += decoder.decode()
    return out
}

describe('json', () => {
    test('sets content-type, serializes body, defaults to 200', async () => {
        const response = json({ hello: 'world', n: 1 })
        expect(response.headers.get('content-type')).toBe('application/json')
        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ hello: 'world', n: 1 })
    })

    test('honors a custom status and merges headers', async () => {
        const response = json({ ok: true }, { status: 201, headers: { 'x-trace': 'abc' } })
        expect(response.status).toBe(201)
        expect(response.headers.get('x-trace')).toBe('abc')
        expect(response.headers.get('content-type')).toBe('application/json')
        expect(await response.json()).toEqual({ ok: true })
    })

    test('does not override a caller-supplied content-type', async () => {
        const response = json({ a: 1 }, { headers: { 'content-type': 'application/problem+json' } })
        expect(response.headers.get('content-type')).toBe('application/problem+json')
    })
})

// `error()`/`redirect()` THROW rather than returning a Response (`rpc = memo + transport`: a handler is a
// memo body, and a memo's failure channel is a throw). These assert the AUTHORING side — that the call
// leaves by throwing and carries what transport needs; `errorResponse` below asserts the rendering side.
describe('error', () => {
    test('throws an HttpError carrying status, statusText and message', () => {
        let caught: unknown
        try {
            error(404, 'not here')
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(HttpError)
        const httpError = caught as HttpError
        expect(httpError.status).toBe(404)
        expect(httpError.statusText).toBe('Not Found')
        expect(httpError.message).toBe('not here')
    })

    test('falls back to the status reason phrase when no message is given', () => {
        expect(() => error(500)).toThrow('Internal Server Error')
    })

    // The whole point of throwing: a handler that fails on one branch keeps its SUCCESS type, because a
    // `throw` is `never` and a union absorbs it — no `OutcomeResponse` brand, no `Payload<R>` stripping.
    test('never reaches a caller as a value', () => {
        const handler = ({ fail }: { fail: boolean }) => (fail ? error(503) : { greeting: 'hi' })
        expect(handler({ fail: false })).toEqual({ greeting: 'hi' })
        expect(() => handler({ fail: true })).toThrow(HttpError)
    })
})

describe('error.typed', () => {
    test('factory throws carrying the typed name and data', () => {
        const rateLimited = error.typed('RateLimited', 429)
        let caught: unknown
        try {
            rateLimited({ retryAfter: 30 })
        } catch (e) {
            caught = e
        }
        const httpError = caught as HttpError
        expect(httpError.status).toBe(429)
        expect(httpError.kind).toBe('RateLimited')
        expect(httpError.data).toEqual({ retryAfter: 30 })
        // `fn.isError(e, name)` is the public narrowing surface and must match on the same field.
        expect(isTypedError(httpError, 'RateLimited')).toBe(true)
        expect(isTypedError(httpError, 'SomethingElse')).toBe(false)
    })

    test('factory works with no data argument', () => {
        const forbidden = error.typed('Forbidden', 403)
        let caught: unknown
        try {
            forbidden()
        } catch (e) {
            caught = e
        }
        const httpError = caught as HttpError
        expect(httpError.status).toBe(403)
        expect(httpError.kind).toBe('Forbidden')
        expect(httpError.data).toBeUndefined()
    })
})

// The rendering half: what transport turns a thrown outcome into. This is the wire shape the browser
// proxy decodes back into an `HttpError`, so the two sides narrow identically.
describe('errorResponse — the wire shape transport renders', () => {
    test('builds a JSON error body with status, statusText, message', async () => {
        const response = errorResponse(404, 'not here')
        expect(response.status).toBe(404)
        expect(response.headers.get('content-type')).toBe('application/json')
        expect(await response.json()).toEqual({
            status: 404,
            statusText: 'Not Found',
            message: 'not here',
        })
    })

    test('a typed failure carries its name + data + marker in the body', async () => {
        const response = errorResponse(429, undefined, {
            kind: 'RateLimited',
            data: { retryAfter: 30 },
        })
        const body = (await response.json()) as Record<string, unknown>
        expect(response.status).toBe(429)
        expect(body.name).toBe('RateLimited')
        expect(body.__typedError).toBe('RateLimited')
        expect(body.data).toEqual({ retryAfter: 30 })
    })

    test('carries declared headers, so a 405 keeps its Allow', () => {
        const response = errorResponse(405, 'nope', { headers: { allow: 'GET, HEAD' } })
        expect(response.headers.get('allow')).toBe('GET, HEAD')
    })
})

describe('redirect', () => {
    test('throws a Redirect defaulting to 302', () => {
        let caught: unknown
        try {
            redirect('/login')
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(Redirect)
        expect((caught as Redirect).status).toBe(302)
        expect((caught as Redirect).url).toBe('/login')
    })

    test('honors an explicit status', () => {
        let caught: unknown
        try {
            redirect('/moved', 301)
        } catch (e) {
            caught = e
        }
        expect((caught as Redirect).status).toBe(301)
        expect((caught as Redirect).url).toBe('/moved')
    })

    // Transport renders it as a real 3xx + Location — a redirect is a navigation, not an error, so it
    // must not arrive as one.
    test('transport renders it as a 3xx with Location', () => {
        let caught: unknown
        try {
            redirect('/moved', 303)
        } catch (e) {
            caught = e
        }
        const response = outcomeResponse(caught)
        expect(response?.status).toBe(303)
        expect(response?.headers.get('location')).toBe('/moved')
    })
})

describe('jsonl', () => {
    test('streams N newline-delimited JSON lines from an async iterable', async () => {
        async function* source() {
            yield { i: 1 }
            yield { i: 2 }
            yield { i: 3 }
        }
        const response = jsonl(source())
        expect(response.headers.get('content-type')).toBe('application/jsonl')
        const text = await drain(response)
        const lines = text.split('\n').filter((line) => line.length > 0)
        expect(lines.length).toBe(3)
        expect(lines.map((line) => JSON.parse(line))).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }])
        expect(text.endsWith('\n')).toBe(true)
    })

    test('streams from a sync iterable', async () => {
        const response = jsonl([1, 2, 'three', { four: 4 }])
        const text = await drain(response)
        const lines = text.split('\n').filter((line) => line.length > 0)
        expect(lines.length).toBe(4)
        expect(lines.map((line) => JSON.parse(line))).toEqual([1, 2, 'three', { four: 4 }])
    })
})

describe('sse', () => {
    test('emits N data: frames from an async iterable', async () => {
        async function* source() {
            yield { tick: 1 }
            yield { tick: 2 }
        }
        const response = sse(source())
        expect(response.headers.get('content-type')).toBe('text/event-stream')
        const text = await drain(response)
        // The `:ok` prelude comment (flushed on connect so onopen fires immediately) is ignored — keep
        // only the `data:` frames.
        const frames = text
            .split('\n\n')
            .filter((frame) => frame.length > 0 && !frame.startsWith(':'))
        expect(frames.length).toBe(2)
        expect(frames[0]).toBe(`data: ${JSON.stringify({ tick: 1 })}`)
        expect(frames[1]).toBe(`data: ${JSON.stringify({ tick: 2 })}`)
    })

    test('emits frames from a sync iterable', async () => {
        const response = sse(['a', 'b', 'c'])
        const text = await drain(response)
        const frames = text
            .split('\n\n')
            .filter((frame) => frame.length > 0 && !frame.startsWith(':'))
        expect(frames.length).toBe(3)
        expect(frames.map((frame) => JSON.parse(frame.replace(/^data: /, '')))).toEqual([
            'a',
            'b',
            'c',
        ])
    })
})
