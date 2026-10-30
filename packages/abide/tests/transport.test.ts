// 16.32 TO 16.36 AND SECTION 17 — WHAT A HANDLER'S VALUE IS ANSWERED AS, over a served app (spawned,
// for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { gate, spawned } from '@abide/harness/gate'

import { reactive } from '#shared'
import { chunksOfStream } from '#shared/reactive/index.ts'

import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const HANDLERS = `import { reactive, refuse } from '@abide/abide'
import { GET, json, page, POST, redirect, request, response, sse } from '@abide/abide/server'
import { reported } from '../../lib/reported.server.ts'

export const shared = GET(reactive(() => ({ n: 1 }), { global: true, ttl: 90_500 }))

export const sharedForever = GET(reactive(() => ({ n: 1 }), { global: true }))

export const aging = GET(reactive(() => ({ n: 1 }), { global: true, ttl: 60_500 }))

export const agingKeyed = GET(
    reactive((args: { n: number }) => ({ n: args.n }), { global: true, ttl: 60_500 }),
)

export const agingGuarded = GET(
    reactive((args: { n: number }) => ({ n: args.n }), { global: true, ttl: 60_500 }),
    { middleware: [async (next) => next()] },
)

export const sharedWrite = POST(reactive(() => ({ n: 1 }), { global: true, ttl: 90_000 }))

export const local = GET(reactive(() => ({ n: 1 }), { ttl: 90_000 }))

export const sharedRefused = GET(
    reactive((args: { n: number }) => (args.n > 0 ? { n: args.n } : refuse(404, 'none')), {
        global: true,
        ttl: 90_000,
    }),
)

export const feed = GET(async function* () {
    yield { n: 1 }
    await Bun.sleep(300)
    yield { n: 2 }
})

// Held after its first line until \`release\` is called, so a reader that has the first line before
// it releases the second proves the line went out before the body was done.
let open = (): void => {}
export const held = GET(async function* () {
    yield { n: 1 }
    await new Promise<void>((done) => {
        open = done
    })
    yield { n: 2 }
})

export const release = POST(() => {
    open()
})

export const late = GET(async function* () {
    await Bun.sleep(150)
    yield { n: 1 }
})

export const binary = GET(async function* () {
    yield new Uint8Array([1, 2])
    yield new Uint8Array([3])
})

export const fixed = GET(() => sse([1, 2]))

export const doc = GET(() => page('<h1>hello</h1>'))

export const streamedDoc = GET(() =>
    page(
        (async function* () {
            yield '<h1>'
            yield 'hello</h1>'
        })(),
    ),
)

export const moved = POST(() => redirect('/there', 303))

export const nothing = POST(() => undefined)

export const nothingAsJson = POST(() => json(undefined))

export const partial = GET(() => {
    response().status = 206
    return json([1, 2])
})

export const raw = GET(() => new Response('teapot', { status: 418 }))

export const file = GET(() => new Blob(['hello world'], { type: 'text/plain' }))

export const gone = GET(
    () =>
        new Promise((_, reject) =>
            request().signal.addEventListener('abort', () => reject(new Error('the client left'))),
        ),
)

export const reports = POST(() => reported.count)

`

let base = ''
let stop = (): void => {}
const RPC = '/answers'

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'index.abide': '<main>home</main>',
        ...handlerFiles('answers', HANDLERS),
        'lib/reported.server.ts': 'export const reported = { count: 0 }\n',
        'layout.abide': `<script server>
import { onError } from '@abide/abide/server'
import { reported } from './lib/reported.server.ts'

onError(() => {
    reported.count += 1
})
</script>
`,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 16.31, 16.52 — nothing to say is a 204 with no type for the nothing. THE REVERT: drop the
// `delete('content-type')` in `answerValue`; the 204 reads `application/json`.
test('a handler returning undefined answers 204 with no content-type — 16.31, 16.52', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/nothing`, { method: 'POST' })
    expect(answer.status).toBe(204)
    expect(answer.headers.get('content-type')).toBeNull()
})

// 16.52 — A BODILESS ANSWER CARRIES NO TYPE AT ANY STATUS, a redirect's as much as a 204's: the
// handler headers default to `application/json`, and only the 204 used to drop it. THE REVERT: guard
// `answerValue`'s `delete('content-type')` with `status === 200`; the 303 reads `application/json`.
test('a redirect answers with no content-type — 16.52', async () => {
    const moved = await Bun.fetch(`${base}${RPC}/moved`, {
        method: 'POST',
        redirect: 'manual',
    })
    expect(moved.status).toBe(303)
    expect(moved.headers.get('content-type')).toBeNull()
    expect(await moved.text()).toBe('')
})

// 16.54 — NO CEILING WHERE NOTHING NAMES ONE, bun's own included. THE REVERT: fall back to
// `1024 * 1024` in `answerRpc`'s ceiling; the body is refused 413.
test('a mutation with no ceiling named takes a body of any size — 16.54', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/nothing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: 'x'.repeat(2 * 1024 * 1024) }),
    })
    expect(answer.status).toBe(204)
})

// 16.50 — A `HEAD` IS THE `GET`'S ANSWER without its body. THE REVERT: match `found.method` against
// `request.method` alone in `answerRpc`; the `HEAD` is refused 404.
test('a HEAD is answered by the GET handler at its address — 16.50', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/shared`, { method: 'HEAD' })
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('application/json')
    expect(await answer.text()).toBe('')
})

// 16.32, 16.44 — A STREAMING HANDLER IS ANSWERED AS IT PRODUCES, jsonl by default, one line a chunk:
// the first line is read while the handler is still waiting to produce the second — which waits on
// a release this test sends only once it has the first, so no clock is read. THE REVERT: settle
// `reached` itself in `outcomeOf` in place of `streamingOrSettled`; the stream settles to one
// snapshot that waits on a release never sent, and the first read reports 'timed out'.
test('a streaming handler is framed as jsonl, a chunk per line, as it produces — 16.32, 16.44', async () => {
    const answering = Bun.fetch(`${base}${RPC}/held`)
    const reading = answering.then((answer) =>
        (answer.body as ReadableStream<Uint8Array>).getReader(),
    )
    let gaveUp: ReturnType<typeof setTimeout> | undefined
    const first = await Promise.race([
        reading
            .then((reader) => reader.read())
            .then(({ value }) => new TextDecoder().decode(value)),
        new Promise<string>((done) => {
            gaveUp = setTimeout(() => done('timed out'), 3000)
        }),
    ])
    clearTimeout(gaveUp)
    await Bun.fetch(`${base}${RPC}/release`, { method: 'POST' })
    expect(first).toBe('{"n":1}\n')
    expect((await answering).headers.get('content-type')).toBe(
        'application/jsonl',
    )
    const reader = await reading
    let rest = ''
    for (;;) {
        const next = await reader.read()
        if (next.done) break
        rest += new TextDecoder().decode(next.value)
    }
    expect(rest).toBe('{"n":2}\n')
})

// 16.32 — A STREAMED ANSWER COPIES EACH CHUNK ONCE, not the accumulation per chunk. The count is every
// element `Array.prototype.slice` hands back while the answer drains, at two lengths woken a chunk a
// task; the claim is the RATIO, which is 2 for a linear drain and 4 for a quadratic one. THE REVERT
// reads every wake through `peek()` — the arm a gated value still takes, so a `transform` that
// returns its input installs it — and reports 125,250 elements at 500 chunks, a ratio of 4.0.
async function elementsCopied(chunks: number): Promise<number> {
    const reverted = (globalThis as { REVERT_PEEK?: boolean | undefined })
        .REVERT_PEEK
    const feed = reactive(
        async function* () {
            for (let index = 0; index < chunks; index += 1) {
                await new Promise((resolve) => setImmediate(resolve))
                yield index
            }
        },
        reverted
            ? { transform: (accumulation: number[]) => accumulation }
            : undefined,
    )
    const slice = Array.prototype.slice
    let copied = 0
    Array.prototype.slice = function (
        this: unknown[],
        start?: number,
        end?: number,
    ) {
        const copy = slice.call(this, start, end)
        copied += copy.length
        return copy
    }
    const sent: unknown[] = []
    try {
        for await (const chunk of chunksOfStream(feed)) sent.push(chunk)
    } finally {
        Array.prototype.slice = slice
    }
    expect(sent).toEqual(Array.from({ length: chunks }, (_, index) => index))
    return copied
}

gate(
    'a streamed answer copies each chunk once — 16.32',
    {
        revert: () => {
            ;(globalThis as { REVERT_PEEK?: boolean | undefined }).REVERT_PEEK =
                true
            return () => {
                ;(
                    globalThis as { REVERT_PEEK?: boolean | undefined }
                ).REVERT_PEEK = undefined
            }
        },
        worth: { copied: 125250, ratio: '4.0' },
    },
    async () => {
        const short = await elementsCopied(250)
        const long = await elementsCopied(500)
        expect(`copied: ${long}, ratio: ${(long / short).toFixed(1)}`).toBe(
            'copied: 500, ratio: 2.0',
        )
    },
)

// 21.15 — A STREAM'S DURATION IS TO ITS FIRST CHUNK, which is what its head waited for. THE REVERT:
// time a stream as settled at the call (`duration: 0` in `outcomeOf`); the header reads `dur=0.0`.
test('a streaming answer times its handler to the first chunk — 21.15', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/late`)
    expect(answer.headers.get('server-timing')).toMatch(/^Started;dur=/)
    const duration = Number(
        /dur=([\d.]+)/.exec(answer.headers.get('server-timing') ?? '')?.[1],
    )
    expect(duration).toBeGreaterThanOrEqual(140)
    await answer.text()
})

// 16.45, 16.46 — sse WHERE `Accept` ASKS FOR IT, with its three headers.
test('Accept naming event-stream frames as sse — 16.45, 16.46, 16.75', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/feed`, {
        headers: { accept: 'text/event-stream' },
    })
    expect(answer.headers.get('content-type')).toBe('text/event-stream')
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(answer.headers.get('x-accel-buffering')).toBe('no')
    expect(await answer.text()).toBe(':\n\ndata: {"n":1}\n\ndata: {"n":2}\n\n')
})

// 16.46, 16.47 — binary chunks admit bytes alone, read off the first chunk.
// 16.44 — ONE JSON VALUE PER LINE, NAMED AS THE READER ASKED: NDJSON's type where it asks for that, the
// same bytes either way. THE REVERT: answer `application/jsonl` whatever `linesType` read; the reader
// asking for NDJSON is handed a type it did not ask for.
test('a reader asking for NDJSON is answered it, the same lines as jsonl — 16.44', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/feed`, {
        headers: { accept: 'application/x-ndjson' },
    })
    expect(answer.headers.get('content-type')).toBe('application/x-ndjson')
    expect(
        (await answer.text()).split('\n').filter(Boolean).length,
    ).toBeGreaterThan(0)
})

// 16.75 — NO FRAMING IS HELD BACK BY A PROXY IN FRONT, sse's or any other. THE REVERT: set
// `x-accel-buffering` in `sseHeaders` alone; jsonl, bytes and a streamed document go without it.
test('every streamed answer tells a proxy not to buffer it — 16.75', async () => {
    for (const [address, accept] of [
        ['feed', '*/*'],
        ['feed', 'text/event-stream'],
        ['binary', '*/*'],
        ['streamedDoc', 'text/html'],
    ] as const) {
        const answer = await Bun.fetch(`${base}${RPC}/${address}`, {
            headers: { accept },
        })
        expect([
            address,
            accept,
            answer.headers.get('x-accel-buffering'),
        ]).toEqual([address, accept, 'no'])
        await answer.arrayBuffer()
    }
})

test('binary chunks are answered as octet-stream — 16.46, 16.47', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/binary`, {
        headers: { accept: 'text/event-stream' },
    })
    expect(answer.headers.get('content-type')).toBe('application/octet-stream')
    expect([...new Uint8Array(await answer.arrayBuffer())]).toEqual([1, 2, 3])
})

// 17.6, 17.7 — A FRAMING A HELPER FIXED IS NOT NEGOTIATED PAST. THE REVERT: read `prefersEventStream`
// ahead of the fixed framing; a caller asking for jsonl is answered jsonl.
test('a framing fixed by a helper is kept whatever Accept asks — 17.6, 17.7', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/fixed`, {
        headers: { accept: 'application/jsonl' },
    })
    expect(answer.headers.get('content-type')).toBe('text/event-stream')
    expect(await answer.text()).toBe(':\n\ndata: 1\n\ndata: 2\n\n')
})

// 17.2, 17.3 — `page` names a document and `redirect` a status and an address.
test('page answers a document and redirect a navigation — 17.2, 17.3', async () => {
    const doc = await Bun.fetch(`${base}${RPC}/doc`)
    expect(doc.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await doc.text()).toBe('<h1>hello</h1>')
    const moved = await Bun.fetch(`${base}${RPC}/moved`, {
        method: 'POST',
        redirect: 'manual',
    })
    expect(moved.status).toBe(303)
    expect(moved.headers.get('location')).toBe('/there')
})

// 17.9, 17.10 — `json` is a bare return's JSON with somewhere to put a status, and `undefined` sent
// as `null`. THE REVERT: drop the `json` arm from `answerValue`; the framing it fixed reads as a
// stream's, and `[1, 2]` is answered as `text/event-stream` where `application/json` is due.
test('json answers its value as JSON, and undefined as null — 17.9, 17.10', async () => {
    const partial = await Bun.fetch(`${base}${RPC}/partial`)
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-type')).toBe('application/json')
    expect(await partial.json()).toEqual([1, 2])
    const empty = await Bun.fetch(`${base}${RPC}/nothingAsJson`, {
        method: 'POST',
        headers: { accept: 'application/json' },
    })
    expect(empty.status).toBe(200)
    expect(empty.headers.get('content-type')).toBe('application/json')
    expect(await empty.text()).toBe('null')
})

// 16.35 — A FILE ON DISK IS ANSWERED WITHOUT READING IT INTO MEMORY: its etag is a stat, and the body
// the file or a slice of it. A slice of a file, and a blob in memory, are still named by their bytes.
// Run in a script of its own, for `serve.test.ts`'s reason, counting what `Blob.prototype.bytes`
// reads. THE REVERT: derive every etag from `await blob.bytes()` in `answerValue`'s blob arm; each
// of the three answers reads the whole file, 3 x 65536 bytes.
test('a returned file is answered off a stat, a slice and a blob off their bytes — 16.35', async () => {
    const dir = temporaryModule({
        'probe.ts': `import { answerValue } from '${new URL('../src/server/answerValue.ts', import.meta.url).pathname}'

const path = import.meta.dir + '/big.bin'
await Bun.write(path, Uint8Array.from({ length: 65536 }, (_, at) => at % 251))
let read = 0
const bytes = Blob.prototype.bytes
Blob.prototype.bytes = function (this: Blob) {
    read += this.size
    return bytes.call(this)
}
const answer = (blob: Blob, headers: Record<string, string> = {}) =>
    answerValue(blob, new Request('http://app.test/', { headers }), new Headers(), 200)

const whole = await answer(Bun.file(path))
const etag = whole.headers.get('etag') as string
const same = await answer(Bun.file(path), { 'if-none-match': etag })
const part = await answer(Bun.file(path), { range: 'bytes=10-19' })
const readServing = read
const partBody = new Uint8Array(await part.arrayBuffer())
const wholeSize = (await whole.arrayBuffer()).byteLength

read = 0
const first = (await answer(Bun.file(path).slice(0, 10))).headers.get('etag')
const second = (await answer(Bun.file(path).slice(10, 20))).headers.get('etag')
const inMemory = await answer(new Blob(['hello']))
const readNamed = read

await Bun.sleep(5)
await Bun.write(path, Uint8Array.from({ length: 65536 }, (_, at) => (at * 7) % 251))
const rewritten = (await answer(Bun.file(path))).headers.get('etag')

console.log(JSON.stringify({
    readServing, wholeSize, same: same.status, part: part.status, partBody: partBody.length, partByte: partBody[0],
    slicesDiffer: first !== second, readNamed, inMemory: inMemory.status, rewrittenDiffers: rewritten !== etag,
}))
`,
    })
    const ran = await spawned(['bun', `${dir}/probe.ts`], { cwd: dir })
    expect(ran.stderr).toBe('')
    expect(JSON.parse(ran.stdout.trim())).toEqual({
        readServing: 0,
        wholeSize: 65536,
        same: 304,
        part: 206,
        partBody: 10,
        partByte: 10,
        slicesDiffer: true,
        readNamed: 25,
        inMemory: 200,
        rewrittenDiffers: true,
    })
}, 30_000)

// 16.36 — a `Response` the handler built is the answer.
test('a returned Response is answered as it stands — 16.36', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/raw`)
    expect(answer.status).toBe(418)
    expect(await answer.text()).toBe('teapot')
})

// 16.34, 16.35 — A BLOB AT ITS OWN TYPE, RANGE-AWARE: 206 for a range, 416 past the end, 304 for its
// own etag, and the whole body where `If-Range` names another version.
test('a Blob is answered at its type and honors Range — 16.34, 16.35', async () => {
    const whole = await Bun.fetch(`${base}${RPC}/file`)
    expect(whole.headers.get('content-type')).toContain('text/plain')
    const etag = whole.headers.get('etag') as string
    expect(await whole.text()).toBe('hello world')

    const part = await Bun.fetch(`${base}${RPC}/file`, {
        headers: { range: 'bytes=0-4' },
    })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 0-4/11')
    expect(await part.text()).toBe('hello')

    const tail = await Bun.fetch(`${base}${RPC}/file`, {
        headers: { range: 'bytes=-5' },
    })
    expect(await tail.text()).toBe('world')

    const past = await Bun.fetch(`${base}${RPC}/file`, {
        headers: { range: 'bytes=50-' },
    })
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe('bytes */11')

    const same = await Bun.fetch(`${base}${RPC}/file`, {
        headers: { 'if-none-match': etag },
    })
    expect(same.status).toBe(304)

    const stale = await Bun.fetch(`${base}${RPC}/file`, {
        headers: { range: 'bytes=0-4', 'if-range': '"another"' },
    })
    expect(stale.status).toBe(200)
})

// 21.8, 21.9, 21.11 — A `GET` OVER A `global` VALUE IS CACHED FOR AS LONG AS THE VALUE LIVES, and
// privately; one over a request-local value and one that lives until `invalidate` keep the default,
// 21.22's where the fixture is served built with the worker registered; a refusal keeps 21.3's
// `no-store`, as does a mutation over one. THE REVERT: drop the `GLOBAL_GETS` read in `answerOutcome`; `shared`
// reads `private, no-store` where a `max-age` is due.
test('a GET over a global value answers a max-age its ttl derives — 21.8, 21.9, 21.11', async () => {
    const header = async (name: string) =>
        (await Bun.fetch(`${base}${RPC}/${name}`)).headers.get('cache-control')
    // 21.11 — ahead of 21.22's windows, the fixture being served where the worker is registered.
    expect(await header('shared')).toMatch(
        /^private, max-age=(8\d|90), stale-while-revalidate=604800, stale-if-error=31536000$/,
    )
    expect(await header('sharedForever')).toBe(
        'private, stale-while-revalidate=604800, stale-if-error=31536000',
    )
    expect(await header('local')).toBe(
        'private, stale-while-revalidate=604800, stale-if-error=31536000',
    )
    expect(await header('sharedRefused?n=1')).toMatch(
        /^private, max-age=(8\d|90), stale-while-revalidate=604800, stale-if-error=31536000$/,
    )
    expect(await header('sharedRefused?n=0')).toBe('private, no-store')
    // A MUTATION IS NEVER A CACHE ENTRY, whatever it is declared over. THE REVERT: drop the method
    // check in `declare`; this reads `private, max-age=90`.
    const written = await Bun.fetch(`${base}${RPC}/sharedWrite`, {
        method: 'POST',
        headers: { origin: base, 'content-type': 'application/json' },
        body: '{}',
    })
    expect(written.headers.get('cache-control')).toBe('private, no-store')
})

// 21.8 — THE AGE OF THE PRODUCTION, NOT THE LENGTH OF THE TTL: each answer out of one production says
// how long that production has left, so no cache holds it past the moment the server itself stops
// serving it. Unkeyed, keyed, and keyed behind a rung — which reaches the entry through an adoption.
// A value built at boot is already older than its first request, so the numbers are read as a drop
// rather than against the `ttl`. THE REVERT: answer `ttl / 1000` in `answerOutcome` rather than the
// deadline less now; every answer reads `max-age=60`, and the second is no lower than the first.
test('a GET over a global value answers the life its production has left — 21.8', async () => {
    const maxAge = async (name: string) =>
        Number(
            /max-age=(\d+)/.exec(
                (await Bun.fetch(`${base}${RPC}/${name}`)).headers.get(
                    'cache-control',
                ) ?? '',
            )?.[1],
        )
    // One sleep between the two passes rather than one per name: each name's second read is
    // still at least the sleep after its first.
    const names = ['aging', 'agingKeyed?n=1', 'agingGuarded?n=1']
    const firsts: number[] = []
    for (const name of names) {
        const first = await maxAge(name)
        expect(first).toBeLessThanOrEqual(60)
        firsts.push(first)
    }
    await Bun.sleep(1_100)
    for (const [index, name] of names.entries())
        expect(await maxAge(name)).toBeLessThan(firsts[index] as number)
}, 10_000)

// 16.63 — A CLIENT THAT LEFT IS NOT A FAULT. A handler waiting on work the request's signal cancels
// throws once the client goes, and that throw is the cancellation arriving rather than something
// broken. A raw socket, because a `fetch` abort can leave a pooled connection open and the server
// never learns the client left. THE REVERT: drop the signal check in `failureOf`; the throw is
// reported, and `onError` counts 1 where 0 is due.
test('a handler that throws after its client left is not reported — 16.63', async () => {
    const count = async (): Promise<number> =>
        (await Bun.fetch(`${base}${RPC}/reports`, { method: 'POST' })).json()
    const before = await count()
    const { hostname, port } = new URL(base)
    const socket = await Bun.connect({
        hostname,
        port: Number(port),
        socket: { data() {} },
    })
    socket.write(`GET ${RPC}/gone HTTP/1.1\r\nhost: ${hostname}\r\n\r\n`)
    await Bun.sleep(100)
    socket.end()
    await Bun.sleep(200)
    expect((await count()) - before).toBe(0)
})
