// `/__abide/logs` — the opt-in, the filters, and the backlog-then-live shape.

import { afterEach, expect, test } from 'bun:test'
import { type LogRecord, logFeed } from '../../shared/internal/logFeed.ts'
import { createTestApp, type TestApp } from '../../test/createTestApp.ts'
import { logsRoute } from './logsRoute.ts'

afterEach(() => {
    logFeed.disable()
    delete Bun.env.ABIDE_LOGS
    delete Bun.env.ABIDE_LOG_BUFFER
})

// The feed is enabled at BIND (createApp), so the env var has to be set before the app boots.
async function bootWithFeed(enabled: boolean): Promise<TestApp> {
    if (enabled) Bun.env.ABIDE_LOGS = '1'
    else delete Bun.env.ABIDE_LOGS
    return await createTestApp({ routes: {} })
}

function record(message: string, level = 'log', channel = 'app', traceparent?: string): void {
    logFeed.publish(level, channel, message, traceparent, new Date())
}

// `follow=0` ends the stream after the backlog, so the whole body is readable as text.
async function readFeed(app: TestApp, query: string): Promise<LogRecord[]> {
    const response = await app.fetch(`/__abide/logs?follow=0&${query}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    const records: LogRecord[] = []
    for (const line of body.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload !== '') records.push(JSON.parse(payload) as LogRecord)
    }
    return records
}

test('default closed: the route 404s when the deployment did not opt in', async () => {
    const app = await bootWithFeed(false)
    try {
        expect(logFeed.enabled).toBe(false)
        const response = await app.fetch('/__abide/logs')
        expect(response.status).toBe(404)
        expect(await response.text()).toContain('ABIDE_LOGS')
    } finally {
        await app.stop()
    }
})

test('ABIDE_LOGS opens the route and the backlog replays oldest-first', async () => {
    const app = await bootWithFeed(true)
    try {
        expect(logFeed.enabled).toBe(true)
        record('first')
        record('second')
        const records = await readFeed(app, 'tail=10')
        const messages = records.map((entry) => entry.message)
        expect(messages).toContain('first')
        expect(messages).toContain('second')
        expect(messages.indexOf('first')).toBeLessThan(messages.indexOf('second'))
    } finally {
        await app.stop()
    }
})

test('--level is a FLOOR: warn admits warn and error, not info', async () => {
    const app = await bootWithFeed(true)
    try {
        record('an info', 'info')
        record('a warning', 'warn')
        record('an error', 'error')
        const messages = (await readFeed(app, 'tail=50&level=warn')).map((entry) => entry.message)
        expect(messages).toContain('a warning')
        expect(messages).toContain('an error')
        expect(messages).not.toContain('an info')
    } finally {
        await app.stop()
    }
})

test('--debug uses the DEBUG grammar, so a trailing * matches a namespace', async () => {
    const app = await bootWithFeed(true)
    try {
        record('rpc line', 'log', 'abide:rpc')
        record('memo line', 'log', 'abide:memo')
        record('app line', 'log', 'myapp')
        const messages = (await readFeed(app, 'tail=50&debug=abide:*')).map(
            (entry) => entry.message,
        )
        expect(messages).toContain('rpc line')
        expect(messages).toContain('memo line')
        expect(messages).not.toContain('app line')
    } finally {
        await app.stop()
    }
})

test('--trace matches a PREFIX, so the 8 hex the pretty line prints is enough', async () => {
    const app = await bootWithFeed(true)
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    try {
        record('in the trace', 'log', 'app', traceparent)
        record('not in the trace', 'log', 'app')
        const messages = (await readFeed(app, 'tail=50&trace=4bf92f35')).map(
            (entry) => entry.message,
        )
        expect(messages).toEqual(['in the trace'])
    } finally {
        await app.stop()
    }
})

test('tail caps how much history is replayed', async () => {
    const app = await bootWithFeed(true)
    try {
        for (const message of ['a', 'b', 'c', 'd']) record(message)
        const messages = (await readFeed(app, 'tail=2')).map((entry) => entry.message)
        expect(messages).toEqual(['c', 'd'])
    } finally {
        await app.stop()
    }
})

test('a live subscriber receives records published AFTER it connected', async () => {
    const app = await bootWithFeed(true)
    try {
        // No `follow=0` — this is the real tail, so the body stays open and is read incrementally.
        const response = await app.fetch('/__abide/logs?tail=0')
        expect(response.status).toBe(200)
        const reader = (response.body as ReadableStream<Uint8Array>).getReader()
        const decoder = new TextDecoder()

        const readUntilData = async (): Promise<string> => {
            for (;;) {
                const next = await reader.read()
                if (next.done === true) return ''
                const text = decoder.decode(next.value, { stream: true })
                for (const line of text.split('\n')) {
                    if (line.startsWith('data:')) return line.slice(5).trim()
                }
            }
        }

        record('published while watching')
        const payload = await readUntilData()
        expect((JSON.parse(payload) as LogRecord).message).toBe('published while watching')
        await reader.cancel()
    } finally {
        await app.stop()
    }
})

// The two teardown paths, exercised DIRECTLY on the route rather than over HTTP.
//
// Not over HTTP on purpose: Bun does not surface a client hang-up promptly — measured here, neither
// `request.signal` nor the stream's `cancel` fires for seconds after the peer goes away (worst case
// `idleTimeout`, 255s). That latency is Bun's, not this route's, and asserting against it would be a
// slow flaky test of somebody else's socket bookkeeping. What this route owes is that WHEN either
// signal arrives the subscription is released — and a lingering subscriber costs at most `MAX_QUEUE`
// records in the meantime, which is the reason that bound exists.
test('cancelling the stream releases the subscription', async () => {
    logFeed.enable(10)
    const response = logsRoute(
        new URL('http://test.invalid/__abide/logs?tail=0'),
        new AbortController().signal,
    )
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    // sse defers its prelude to the first real read, so a subscription exists only after this.
    await reader.read()
    expect(logFeed.subscriberCount()).toBe(1)
    await reader.cancel()
    expect(logFeed.subscriberCount()).toBe(0)
})

test('aborting the request releases the subscription', async () => {
    logFeed.enable(10)
    const controller = new AbortController()
    const response = logsRoute(
        new URL('http://test.invalid/__abide/logs?tail=0'),
        controller.signal,
    )
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    await reader.read()
    expect(logFeed.subscriberCount()).toBe(1)
    controller.abort()
    expect(logFeed.subscriberCount()).toBe(0)
    await reader.cancel()
})

test('a non-GET verb is a 405 that names what is allowed', async () => {
    const app = await bootWithFeed(true)
    try {
        // Presenting the abide client's non-simple request shape, so the CSRF gate admits it and the
        // method check is what answers. A bare cross-origin POST is refused earlier, by CSRF (403).
        const response = await app.fetch('/__abide/logs', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-abide': '1' },
        })
        expect(response.status).toBe(405)
        expect(response.headers.get('allow')).toBe('GET, HEAD')
    } finally {
        await app.stop()
    }
})
