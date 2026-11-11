// 16.93 — A STREAMING `GET` IS READ OVER THE MUX, holding no http connection while it streams. The
// browser's socket is the loopback (`muxLoopback.ts`), whose `stream` frames the server's own half
// answers through `answer` below; `fetch` counts what a copy asks over http and keeps open.

import { afterAll, expect, test } from 'bun:test'

import { handedOff } from '#server/handedOff.ts'
import { park, takeParked } from '#server/parkedAnswers.ts'
import { streamOverMux } from '#server/streamOverMux.ts'
import { flushSync } from '#shared'
import { resetSocketWire } from '#ui/socketWire.ts'
import { wire } from '#ui/wire.ts'

import { fromLoopbackBrowser, installMuxLoopback } from './muxLoopback.ts'

// AN ORIGIN OF THIS FILE'S OWN, for `followWire.test.ts`'s reason: the muxes are process-wide.
const ORIGIN = 'http://stream-mux.test'
const encoder = new TextEncoder()

// Each stream the server is answering, by its `n`, with what feeds it and whether it was cancelled.
const answering = new Map<
    string,
    { send(line: string): void; close(): void; cancelled: boolean }
>()

// How often the handler behind each address ran.
const ran = new Map<string, number>()

/**
 * The server's answer to a call: a jsonl body fed from the test, a binary, a stream that signs in, or
 * one that refuses last — or, 16.94, an answer the mux parked, taken by its token.
 */
async function answer(request: Request): Promise<Response> {
    const parked = takeParked(request)
    if (parked !== undefined) return parked
    const url = new URL(request.url)
    ran.set(url.pathname, (ran.get(url.pathname) ?? 0) + 1)
    const n = url.searchParams.get('n') ?? ''
    if (url.pathname.endsWith('/bytes'))
        return new Response(new Uint8Array([1, 2]), {
            headers: { 'content-type': 'application/octet-stream' },
        })
    if (url.pathname.endsWith('/signin'))
        return new Response('{"at":1}\n{"at":2}\n', {
            headers: {
                'content-type': 'application/x-ndjson',
                'set-cookie': 'abide-principal=sealed; Path=/',
            },
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
// Every address the copies fetched, and what they presented a parked answer's token in.
const asked: { url: string; parked: string | null }[] = []
const unstubbedFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
    fetched += 1
    asked.push({
        url: String(input),
        parked: new Headers(init?.headers).get('abide-parked'),
    })
    const answered = await answer(
        fromLoopbackBrowser(new Request(String(input), init)),
    )
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

// 16.94 — AN ANSWER THE MUX CANNOT CARRY IS TAKEN OVER HTTP, AND THE HANDLER RUNS ONCE: a binary, which
// a text frame cannot carry, and a stream that writes a cookie, which a socket cannot deliver. THE
// REVERT: send `http` with no token in `streamOverMux`, as the mux did before it parked them; the
// browser calls again over http, and each handler runs 2 times where 1 is due.
test('an answer the mux cannot carry is taken over http, its handler run once — 16.94', async () => {
    const bytes = wire('GET', `${ORIGIN}/bytes`, { stream: true }) as () => Copy
    const chunks = (await bytes()) as Uint8Array[]
    expect([...(chunks[0] as Uint8Array)]).toEqual([1, 2])
    const signin = wire('GET', `${ORIGIN}/signin`, {
        stream: true,
    }) as () => Copy
    expect(await signin()).toEqual([{ at: 1 }, { at: 2 }])
    expect({ bytes: ran.get('/bytes'), signin: ran.get('/signin') }).toEqual({
        bytes: 1,
        signin: 1,
    })
    // 16.98 — taken by a token in its header, and no address it asked names one. THE REVERT: put the
    // token back in `parkedRequest`'s query; the URLs carry `token=` and no header does.
    const taking = asked.filter((one) => one.url.includes('/__abide/parked'))
    expect(taking.length).toBe(2)
    for (const one of taking) {
        expect(one.url).not.toContain('?')
        expect(one.parked).toBeString()
    }
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

// 16.97 — AN EARLY-CALLED STREAM IS ANSWERED OVER HTTP TO ITS FIRST CHUNK, then handed to the mux: the
// http body ends while the run streams on, its last line the token the rest is taken by, and the rest
// is the same run's. THE REVERT: return the answer unwrapped from `handedOff`; the http body is still
// open after its first chunk and no token is read, so `ended` is false.
test('an early-called stream ends its http leg after its first chunk, and the rest is taken by token — 16.97', async () => {
    let send = (_line: string): void => {}
    let close = (): void => {}
    const run = new ReadableStream<Uint8Array>({
        start(controller) {
            send = (line) => controller.enqueue(encoder.encode(line))
            close = () => controller.close()
        },
    })
    const http = handedOff(
        new Response(run, {
            headers: { 'content-type': 'application/x-ndjson' },
        }),
        asking('ada'),
    )
    send('{"at":1}\n{"at"')
    const reader = (http.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let read = ''
    let ended = false
    for (let turns = 0; turns < 3 && !ended; turns += 1) {
        const next = await Promise.race([
            reader.read(),
            Bun.sleep(50).then(() => undefined),
        ])
        if (next === undefined) continue
        if (next.done) ended = true
        else read += decoder.decode(next.value)
    }
    expect(ended).toBe(true)
    const [first, continuation] = read.trim().split('\n')
    expect(JSON.parse(first as string)).toEqual({ at: 1 })
    const token = (JSON.parse(continuation as string) as Record<string, string>)
        .$continue as string
    send(':2}\n')
    close()
    const rest = takeParked(claim('ada', token)) as Response
    expect(await rest.text()).toBe('{"at":2}\n')
})

/** A request from the browser at `caller`. */
function asking(caller: string, headers: Record<string, string> = {}): Request {
    return new Request(`${ORIGIN}/ticks`, {
        headers: { cookie: `abide-caller=${caller}`, ...headers },
    })
}

/** What the browser at `caller` asks `/__abide/parked` with, presenting `token`. */
function claim(caller: string, token: string): Request {
    return new Request(`${ORIGIN}/__abide/parked`, {
        headers: { cookie: `abide-caller=${caller}`, 'abide-parked': token },
    })
}

// 16.98 — A PARKED ANSWER IS ITS OWN BROWSER'S: the right token from another browser is answered as a
// token that names nothing — 404, and the answer stays for its own — and the answer taken is not
// stored. THE REVERT: drop the owner test from `takeParked`; bo is served ada's answer, 200 and her
// cookie, where 404 is due.
test('a parked answer is refused to another browser presenting its token — 16.98', async () => {
    const run = new AbortController()
    const token = park(
        new Response('{"at":1}\n', {
            headers: {
                'content-type': 'application/x-ndjson',
                'set-cookie': 'abide-principal=ada-seal; Path=/',
            },
        }),
        run,
        asking('ada'),
    ) as string
    const stolen = takeParked(claim('bo', token)) as Response
    expect(stolen.status).toBe(404)
    expect(stolen.headers.get('set-cookie')).toBeNull()
    expect((takeParked(claim('bo', 'not-a-token')) as Response).status).toBe(
        404,
    )
    const taken = takeParked(claim('ada', token)) as Response
    expect(taken.status).toBe(200)
    expect(taken.headers.get('cache-control')).toBe('no-store')
    expect(await taken.text()).toBe('{"at":1}\n')
    // Taken once.
    expect((takeParked(claim('ada', token)) as Response).status).toBe(404)
})
