// 16.93 — A STREAMING `GET` IS READ OVER THE MUX, holding no http connection while it streams. The
// browser's socket is the loopback (`muxLoopback.ts`), whose `stream` frames the server's own half
// answers through `answer` below; `fetch` counts what a copy asks over http and keeps open.

import { afterAll, expect, test } from 'bun:test'

import { streamOverMux } from '#server/streamOverMux.ts'
import { flushSync } from '#shared'
import { resetSocketWire } from '#ui/socketWire.ts'
import { wire } from '#ui/wire.ts'

import { installMuxLoopback } from './muxLoopback.ts'

// AN ORIGIN OF THIS FILE'S OWN, for `followWire.test.ts`'s reason: the muxes are process-wide.
const ORIGIN = 'http://stream-mux.test'
const encoder = new TextEncoder()

// Each stream the server is answering, by its `n`, with what feeds it and whether it was cancelled.
const answering = new Map<
    string,
    { send(line: string): void; close(): void; cancelled: boolean }
>()

/** The server's answer to a call: a jsonl body fed from the test, a binary, or a stream that refuses last. */
async function answer(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const n = url.searchParams.get('n') ?? ''
    if (url.pathname.endsWith('/bytes'))
        return new Response(new Uint8Array([1, 2]), {
            headers: { 'content-type': 'application/octet-stream' },
        })
    const fed = {
        send: (_line: string): void => {},
        close: (): void => {},
        cancelled: false,
    }
    answering.set(n, fed)
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                fed.send = (line) => controller.enqueue(encoder.encode(line))
                fed.close = () => controller.close()
            },
            cancel() {
                fed.cancelled = true
            },
        }),
        { headers: { 'content-type': 'application/x-ndjson' } },
    )
}

// What the copies asked over http, and of that what is still open.
let fetched = 0
let open = 0
const unstubbedFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
    fetched += 1
    const answered = await answer(new Request(String(input), init))
    open += 1
    const body = answered.body as ReadableStream<Uint8Array>
    return new Response(
        body.pipeThrough(
            new TransformStream({
                flush() {
                    open -= 1
                },
            }),
        ),
        { status: answered.status, headers: answered.headers },
    )
}) as unknown as typeof fetch
const restoreSocket = installMuxLoopback(answer)

afterAll(() => {
    globalThis.fetch = unstubbedFetch
    restoreSocket()
    resetSocketWire()
})

type Copy = (() => unknown) & {
    ready(): boolean
    busy(): boolean
    error(): unknown
} & PromiseLike<unknown>

async function landed(copy: Copy): Promise<unknown> {
    for (let turns = 0; turns < 200 && !copy.ready(); turns += 1)
        await Bun.sleep(1)
    return copy()
}

// THE GATE: K copies streaming, and once each has shown its first chunk, the http connections they
// hold. THE REVERT: read every stream with `answerOf` in `wire`'s `streamed` (skip `streamOverMux`);
// 3 fetches open where 0 are due.
test('a page reading K streams holds no http connection while they stream — 16.93', async () => {
    const ticks = wire('GET', `${ORIGIN}/ticks`, { stream: true }) as (args: {
        n: string
    }) => Copy
    const copies: Copy[] = []
    for (const n of ['a', 'b', 'c']) copies.push(ticks({ n }))
    for (let turns = 0; turns < 200 && answering.size < 3; turns += 1)
        await Bun.sleep(1)
    for (const fed of answering.values()) fed.send('{"at":1}\n')
    for (const copy of copies) expect(await landed(copy)).toEqual([{ at: 1 }])
    for (const copy of copies) expect(copy.busy()).toBe(true)

    expect({ fetched, open }).toEqual({ fetched: 0, open: 0 })

    for (const fed of answering.values()) {
        fed.send('{"at":2}\n')
        fed.close()
    }
    for (const copy of copies)
        expect(await copy).toEqual([{ at: 1 }, { at: 2 }])
})

// 16.68 OVER THE MUX — the refusal a stream ends on is its last frame, read after the chunks before
// it, as it is over http: the frames carry the body's text, which the copy reads as a body.
test('a stream that refuses after its head ends on that refusal — 16.68, 16.93', async () => {
    const ticks = wire('GET', `${ORIGIN}/refusing`, {
        stream: true,
    }) as (args: { n: string }) => Copy
    const copy = ticks({ n: 'refusing' })
    for (let turns = 0; turns < 200 && !answering.has('refusing'); turns += 1)
        await Bun.sleep(1)
    const fed = answering.get('refusing') as {
        send(line: string): void
        close(): void
    }
    fed.send('{"at":1}\n')
    fed.send(
        `${JSON.stringify({ $refusal: { type: 'about:blank', title: 'Conflict', status: 409, detail: 'taken' } })}\n`,
    )
    fed.close()
    await Promise.resolve(copy).catch(() => {})
    for (let turns = 0; turns < 200 && copy.error() === undefined; turns += 1)
        await Bun.sleep(1)
    flushSync()
    expect((copy.error() as { status?: number }).status).toBe(409)
})

// 16.48 OVER THE MUX — a load its signal ends stops the server's stream, which is told so.
// THE REVERT: drop the `unsub` a stream's abort sends; the server's body is never cancelled.
test('a stream whose load is aborted stops the server answering it — 16.48, 16.93', async () => {
    const ticks = wire('GET', `${ORIGIN}/aborted`, { stream: true }) as (
        args: { n: string },
        options?: { signal?: AbortSignal },
    ) => Copy
    const ending = new AbortController()
    const copy = ticks({ n: 'aborted' }, { signal: ending.signal })
    for (let turns = 0; turns < 200 && !answering.has('aborted'); turns += 1)
        await Bun.sleep(1)
    const fed = answering.get('aborted') as {
        send(line: string): void
        cancelled: boolean
    }
    fed.send('{"at":1}\n')
    await landed(copy)
    ending.abort()
    for (let turns = 0; turns < 200 && !fed.cancelled; turns += 1)
        await Bun.sleep(1)
    expect(fed.cancelled).toBe(true)
})

// A BINARY IS SENT BACK TO HTTP, which a text frame cannot carry: the copy fetches it there, once.
test('a stream answering a binary is read over http instead — 16.93', async () => {
    const before = fetched
    const bytes = wire('GET', `${ORIGIN}/bytes`, { stream: true }) as () => Copy
    const chunks = (await bytes()) as Uint8Array[]
    expect([...(chunks[0] as Uint8Array)]).toEqual([1, 2])
    expect(fetched).toBe(before + 1)
})

// 18.30 — PUMPED AT THE SOCKET'S PACE: a frame bun buffered rather than sent holds the next read off
// the body until the socket drains. THE REVERT: drop the `drained` wait in `streamOverMux`; the body
// is pulled 3 times before the drain where 1 is due.
test('a stream reads no further while the socket holds a frame unsent — 18.30, 16.93', async () => {
    let pulls = 0
    let resume = (): void => {}
    const body = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                pulls += 1
                controller.enqueue(encoder.encode(`{"at":${pulls}}\n`))
                if (pulls === 3) controller.close()
            },
        },
        { highWaterMark: 0 },
    )
    const ending = new AbortController()
    const pumped = streamOverMux(
        {
            peer: {
                send: (_id, frame) => (frame.op === 'lines' ? -1 : 1),
                close() {},
            },
            drained: () => new Promise((resumed) => (resume = resumed)),
        },
        1,
        '/ticks',
        new Request(`${ORIGIN}/__abide/socket`),
        async () =>
            new Response(body, {
                headers: { 'content-type': 'application/x-ndjson' },
            }),
        ending.signal,
    )
    await Bun.sleep(10)
    expect(pulls).toBe(1)
    resume()
    await Bun.sleep(10)
    expect(pulls).toBe(2)
    ending.abort()
    resume()
    await pumped
})
