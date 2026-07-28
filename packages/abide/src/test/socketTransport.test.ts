// End-to-end tests for the socket transport (sockets.md S3-S5): the multiplexed WS at
// `/__abide/sockets`, the per-socket HTTP face (SSE subscribe / POST publish), and the
// CSWSH origin gate. Boots the real router via createTestApp; every WS client and server is
// closed in cleanup so a stray subscription never hangs the run.

import { afterEach, describe, expect, test } from 'bun:test'
import { error } from '../server/error.ts'
import type { Middleware } from '../server/internal/middleware.ts'
import { socket } from '../server/socket.ts'
import { identity } from '../shared/identity.ts'
import { route } from '../shared/route.ts'
import { createTestApp, type SocketClient, type TestApp } from './createTestApp.ts'

const TEST_TIMEOUT = 5000

let running: TestApp | undefined
const openClients: SocketClient[] = []

async function start(config?: Parameters<typeof createTestApp>[0]): Promise<TestApp> {
    const app = await createTestApp(config)
    running = app
    return app
}

function client(app: TestApp): SocketClient {
    const c = app.socket()
    openClients.push(c)
    return c
}

afterEach(async () => {
    for (const c of openClients) c.close()
    openClients.length = 0
    if (running !== undefined) {
        await running.stop()
        running = undefined
    }
})

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`timeout: ${label}`)), ms),
        ),
    ])
}

// Pull `count` messages off an async iterable, each guarded by a timeout so a lost message
// fails the test instead of hanging.
async function take<T>(iterable: AsyncIterable<T>, count: number, ms: number): Promise<T[]> {
    const out: T[] = []
    const iterator = iterable[Symbol.asyncIterator]()
    for (let i = 0; i < count; i++) {
        const result = await withTimeout(iterator.next(), ms, `take ${i + 1}/${count}`)
        if (result.done === true) break
        out.push(result.value)
    }
    return out
}

// A stateful SSE frame reader — buffers across chunks so a single network chunk carrying
// multiple `data:` frames (or a frame split across chunks) is parsed correctly frame-by-frame.
function sseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder()
    let buffer = ''
    return async (ms: number): Promise<unknown> => {
        while (true) {
            const boundary = buffer.indexOf('\n\n')
            if (boundary >= 0) {
                const line = buffer.slice(0, boundary)
                buffer = buffer.slice(boundary + 2)
                // Skip comment frames (`:...`) — the `:ok` connect prelude + heartbeats aren't data.
                if (line.startsWith(':')) continue
                return JSON.parse(line.slice('data: '.length))
            }
            const result = await withTimeout(reader.read(), ms, 'sse read')
            if (result.done === true) return undefined
            buffer += decoder.decode(result.value, { stream: true })
        }
    }
}

describe('socket transport — WebSocket mux', () => {
    test(
        'a WS subscriber receives a server-side publish',
        async () => {
            const ticks = socket<number>({ clientPublish: true, channel: { tail: 2 } })
            const app = await start({ sockets: { ticks } })

            const c = client(app)
            const stream = c.subscribe<number>('ticks')
            await c.ready()
            await delay(30) // let the sub frame register server-side before publishing

            ticks.publish(42)
            expect(await take(stream, 1, TEST_TIMEOUT)).toEqual([42])
        },
        TEST_TIMEOUT,
    )

    test(
        'tail replay — a late subscriber replays the last N messages',
        async () => {
            const ticks = socket<number>({ clientPublish: true, channel: { tail: 2 } })
            const app = await start({ sockets: { ticks } })

            // Publish before anyone subscribes; tail:2 retains the last two.
            ticks.publish(1)
            ticks.publish(2)
            ticks.publish(3)

            const c = client(app)
            const stream = c.subscribe<number>('ticks')
            await c.ready()

            expect(await take(stream, 2, TEST_TIMEOUT)).toEqual([2, 3])
        },
        TEST_TIMEOUT,
    )

    test(
        'client publish over the WS reaches subscribers',
        async () => {
            const ticks = socket<string>({ clientPublish: true, channel: { tail: 2 } })
            const app = await start({ sockets: { ticks } })

            const subscriber = client(app)
            const stream = subscriber.subscribe<string>('ticks')
            await subscriber.ready()
            await delay(30)

            const publisher = client(app)
            await publisher.ready()
            publisher.publish('ticks', 'from-client')

            expect(await take(stream, 1, TEST_TIMEOUT)).toEqual(['from-client'])
        },
        TEST_TIMEOUT,
    )

    test(
        'client publish is ignored when clientPublish is off',
        async () => {
            const quiet = socket<string>({ clientPublish: false })
            const app = await start({ sockets: { quiet } })

            const stream = quiet[Symbol.asyncIterator]()
            // Subscribe server-side directly to observe fanout; the WS publish must not reach it.
            const wsPublisher = client(app)
            await wsPublisher.ready()
            wsPublisher.publish('quiet', 'nope')
            await delay(40)

            // Then a server publish DOES arrive, proving the socket is otherwise live.
            quiet.publish('yes')
            const result = await withTimeout(stream.next(), TEST_TIMEOUT, 'quiet next')
            expect(result.value).toBe('yes')
            await stream.return?.()
        },
        TEST_TIMEOUT,
    )
})

describe('socket transport — HTTP face', () => {
    test(
        'POST publishes a client message that reaches WS subscribers',
        async () => {
            const ticks = socket<string>({ clientPublish: true, channel: { tail: 2 } })
            const app = await start({ sockets: { ticks } })

            const subscriber = client(app)
            const stream = subscriber.subscribe<string>('ticks')
            await subscriber.ready()
            await delay(30)

            const response = await app.fetch('/__abide/sockets/ticks', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify('via-http'),
            })
            expect(response.status).toBe(200)

            expect(await take(stream, 1, TEST_TIMEOUT)).toEqual(['via-http'])
        },
        TEST_TIMEOUT,
    )

    test(
        'POST is rejected 403 when clientPublish is off',
        async () => {
            const quiet = socket<string>({ clientPublish: false })
            const app = await start({ sockets: { quiet } })

            const response = await app.fetch('/__abide/sockets/quiet', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify('x'),
            })
            expect(response.status).toBe(403)
        },
        TEST_TIMEOUT,
    )

    test(
        'GET streams messages over SSE',
        async () => {
            const ticks = socket<string>({ clientPublish: true, channel: { tail: 2 } })
            const app = await start({ sockets: { ticks } })

            // Seed the tail so the SSE subscribe replays an immediate frame — Bun's client `fetch`
            // resolves a streaming response only once its first body chunk arrives.
            ticks.publish('replayed')

            const response = await app.fetch('/__abide/sockets/ticks')
            expect(response.headers.get('content-type')).toContain('text/event-stream')
            const body = response.body
            if (body === null) throw new Error('expected an SSE response body')
            const reader = body.getReader()
            const readFrame = sseReader(reader)

            expect(await readFrame(TEST_TIMEOUT)).toBe('replayed')

            ticks.publish('live')
            expect(await readFrame(TEST_TIMEOUT)).toBe('live')

            await reader.cancel()
        },
        TEST_TIMEOUT,
    )

    test(
        'unknown socket 404s on the HTTP face',
        async () => {
            const app = await start({ sockets: {} })
            const response = await app.fetch('/__abide/sockets/nope')
            expect(response.status).toBe(404)
        },
        TEST_TIMEOUT,
    )

    // The HTTP face used to return straight out of `Bun.serve.fetch`, ~110 lines above the request
    // scope, the middleware onion, the CSRF gate and the response stamping. So a state-changing,
    // cookie-authenticated POST ran none of them: `export const middleware = [auth]` did not protect
    // a socket publish. These four pin it to the same policy stack every other route runs.

    test(
        'global middleware gates the HTTP face — a denied publish never reaches the socket',
        async () => {
            const ticks = socket<string>({ clientPublish: true, channel: { tail: 4 } })
            const deny: Middleware = () => error(401, 'nope')
            const app = await start({ sockets: { ticks }, middleware: [deny] })

            const response = await app.fetch('/__abide/sockets/ticks', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify('blocked'),
            })
            expect(response.status).toBe(401)
            expect(ticks.chunks()).toEqual([])
        },
        TEST_TIMEOUT,
    )

    test(
        "a socket's own middleware gates its HTTP face, as it already gated the WS join",
        async () => {
            const guarded = socket<string>({
                clientPublish: true,
                channel: { tail: 4 },
                middleware: [() => error(403, 'not yours')],
            })
            const app = await start({ sockets: { guarded } })

            const response = await app.fetch('/__abide/sockets/guarded', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify('blocked'),
            })
            expect(response.status).toBe(403)
            expect(guarded.chunks()).toEqual([])
        },
        TEST_TIMEOUT,
    )

    test(
        'the AU8 CSRF gate covers a socket publish — a simple-shape POST is rejected',
        async () => {
            const ticks = socket<string>({ clientPublish: true, channel: { tail: 4 } })
            const app = await start({ sockets: { ticks } })

            // No `application/json` and no `x-abide`: the exact shape a cross-site <form> can send.
            const response = await app.fetch('/__abide/sockets/ticks', {
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                body: '"forged"',
            })
            expect(response.status).toBe(403)
            expect(ticks.chunks()).toEqual([])
        },
        TEST_TIMEOUT,
    )

    test(
        'route() reports the face as socket-subscribe / socket-publish, and the reply is stamped',
        async () => {
            const seen: string[] = []
            const ticks = socket<string>({ clientPublish: true, channel: { tail: 4 } })
            const record: Middleware = (next) => {
                seen.push(`${route().kind}:${route().name}`)
                return next()
            }
            const app = await start({ sockets: { ticks }, middleware: [record] })

            const published = await app.fetch('/__abide/sockets/ticks', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify('through'),
            })
            expect(published.status).toBe(200)
            // Stamped by `finalize`/`applyResponseHeaders`, which the old early return skipped.
            expect(published.headers.get('traceparent')).not.toBeNull()
            expect(published.headers.get('x-content-type-options')).toBe('nosniff')
            expect(seen).toEqual(['socket-publish:ticks'])
        },
        TEST_TIMEOUT,
    )
})

// A per-room guard: the `secret` room is admissible only to the `owner` identity; every other room
// is public. Reads the room off `route().params` (where the socket-join re-auth places the room args)
// and the connection identity off `identity()` — the exact rpc middleware model (ADR 0023 rooms).
const roomGuard: Middleware = (next) => {
    const room = (route().params as { room?: string }).room
    if (room === 'secret' && identity().id !== 'owner') return error(403, 'denied')
    return next()
}

describe('socket transport — rooms + per-room auth', () => {
    test(
        'rooms — a subscriber to room A does not receive room B over the mux',
        async () => {
            const feed = socket<string, { room: string }>({ channel: { tail: 2 } })
            const app = await start({ sockets: { feed } })

            const c = client(app)
            const a = c.subscribe<string>('feed', { room: 'a' })
            await c.ready()
            await delay(30)

            feed.publish({ room: 'b' }, 'to-b') // must NOT reach room a
            feed.publish({ room: 'a' }, 'to-a')
            expect(await take(a, 1, TEST_TIMEOUT)).toEqual(['to-a'])
        },
        TEST_TIMEOUT,
    )

    test(
        'per-room auth — an unauthorized identity is DENIED the guarded room but allowed a public one',
        async () => {
            const feed = socket<string, { room: string }>({
                channel: { tail: 2 },
                middleware: [roomGuard],
            })
            const app = await start({ sockets: { feed } })

            const c = client(app) // anonymous
            c.subscribe('feed', { room: 'secret' })
            c.subscribe('feed', { room: 'public' })
            await c.ready()

            expect(
                await withTimeout(c.ack('feed', { room: 'secret' }), TEST_TIMEOUT, 'ack secret'),
            ).toBe('error')
            expect(
                await withTimeout(c.ack('feed', { room: 'public' }), TEST_TIMEOUT, 'ack public'),
            ).toBe('ok')
        },
        TEST_TIMEOUT,
    )

    test(
        'per-room auth — the owner identity is admitted to the guarded room and receives its messages',
        async () => {
            const feed = socket<string, { room: string }>({
                channel: { tail: 2 },
                middleware: [roomGuard],
            })
            const app = await start({ sockets: { feed } })

            const owner = app.as({ id: 'owner', authenticated: true })
            const c = owner.socket()
            openClients.push(c)
            const s = c.subscribe<string>('feed', { room: 'secret' })
            await c.ready()

            expect(await withTimeout(c.ack('feed', { room: 'secret' }), TEST_TIMEOUT, 'ack')).toBe(
                'ok',
            )
            await delay(20)
            feed.publish({ room: 'secret' }, 'classified')
            expect(await take(s, 1, TEST_TIMEOUT)).toEqual(['classified'])
        },
        TEST_TIMEOUT,
    )

    test(
        'per-room publish auth — an unauthorized client CANNOT publish into a guarded room',
        async () => {
            const feed = socket<string, { room: string }>({
                channel: { tail: 2 },
                middleware: [roomGuard],
                clientPublish: true,
            })
            const app = await start({ sockets: { feed } })

            // The owner legitimately subscribes to the guarded room.
            const owner = app.as({ id: 'owner', authenticated: true })
            const sub = owner.socket()
            openClients.push(sub)
            const s = sub.subscribe<string>('feed', { room: 'secret' })
            await sub.ready()
            expect(
                await withTimeout(sub.ack('feed', { room: 'secret' }), TEST_TIMEOUT, 'ack'),
            ).toBe('ok')
            await delay(20)

            // An anonymous client attempts to inject into the guarded room — denied at the publish gate.
            const attacker = client(app)
            await attacker.ready()
            attacker.publish('feed', 'injected', { room: 'secret' })
            await delay(60)

            // A legitimate server publish proves the room is otherwise live; the injected message must
            // never have arrived (the owner sees only 'legit').
            feed.publish({ room: 'secret' }, 'legit')
            expect(await take(s, 1, TEST_TIMEOUT)).toEqual(['legit'])
        },
        TEST_TIMEOUT,
    )
})

describe('socket transport — CSWSH', () => {
    test(
        'a WS upgrade with a foreign Origin is rejected when APP_URL is set',
        async () => {
            const original = Bun.env.APP_URL
            Bun.env.APP_URL = 'http://app.example'
            try {
                const app = await start({ sockets: { ticks: socket<number>() } })
                const response = await app.fetch('/__abide/sockets', {
                    headers: {
                        origin: 'http://evil.example',
                        upgrade: 'websocket',
                        connection: 'Upgrade',
                    },
                })
                expect(response.status).toBe(403)
            } finally {
                if (original === undefined) delete Bun.env.APP_URL
                else Bun.env.APP_URL = original
            }
        },
        TEST_TIMEOUT,
    )
})
