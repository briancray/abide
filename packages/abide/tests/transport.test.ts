// 16.33 TO 16.37 AND SECTION 17 — WHAT A HANDLER'S VALUE IS ANSWERED AS, over a served app (spawned,
// for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const HANDLERS = `import { GET, page, POST, redirect, sse } from 'abide/server'

export const feed = GET(async function* () {
    yield { n: 1 }
    await Bun.sleep(300)
    yield { n: 2 }
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

export const moved = POST(() => redirect('/there', 303))

export const raw = GET(() => new Response('teapot', { status: 418 }))

export const file = GET(() => new Blob(['hello world'], { type: 'text/plain' }))
`

let base = ''
let stop = (): void => {}
const RPC = '/__abide/rpc/answers'

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/answers.ts': HANDLERS,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 16.33, 16.46 — A STREAMING HANDLER IS ANSWERED AS IT PRODUCES, jsonl by default, one line a chunk:
// the first line is read while the handler is still waiting to produce the second. THE REVERT:
// drop the `isStreaming` check in `outcomeOf`; the stream settles to one snapshot, and the first read
// waits the 300 ms out and arrives as one JSON array.
test('a streaming handler is framed as jsonl, a chunk per line, as it produces — 16.33, 16.46', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/feed`)
    expect(answer.headers.get('content-type')).toBe('application/jsonl')
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    const started = performance.now()
    const first = new TextDecoder().decode((await reader.read()).value)
    expect(performance.now() - started).toBeLessThan(250)
    expect(first).toBe('{"n":1}\n')
    let rest = ''
    for (;;) {
        const next = await reader.read()
        if (next.done) break
        rest += new TextDecoder().decode(next.value)
    }
    expect(rest).toBe('{"n":2}\n')
})

// 21.15 — A STREAM'S DURATION IS TO ITS FIRST CHUNK, which is what its head waited for. THE REVERT:
// time a stream as settled at the call (`duration: 0` in `outcomeOf`); the header reads `dur=0.0`.
test('a streaming answer times its handler to the first chunk — 21.15', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/late`)
    const duration = Number(
        /dur=([\d.]+)/.exec(answer.headers.get('server-timing') ?? '')?.[1],
    )
    expect(duration).toBeGreaterThanOrEqual(140)
    await answer.text()
})

// 16.47, 16.48 — sse WHERE `Accept` ASKS FOR IT, with its three headers.
test('Accept naming event-stream frames as sse — 16.47, 16.48', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/feed`, {
        headers: { accept: 'text/event-stream' },
    })
    expect(answer.headers.get('content-type')).toBe('text/event-stream')
    expect(answer.headers.get('cache-control')).toBe('no-cache')
    expect(answer.headers.get('x-accel-buffering')).toBe('no')
    expect(await answer.text()).toBe(':\n\ndata: {"n":1}\n\ndata: {"n":2}\n\n')
})

// 16.48, 16.49 — binary chunks admit bytes alone, read off the first chunk.
test('binary chunks are answered as octet-stream — 16.48, 16.49', async () => {
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

// 16.36 — A FILE ON DISK IS ANSWERED WITHOUT READING IT INTO MEMORY: its etag is a stat, and the body
// the file or a slice of it. A slice of a file, and a blob in memory, are still named by their bytes.
// Run in a script of its own, for `serve.test.ts`'s reason, counting what `Blob.prototype.bytes`
// reads. THE REVERT: derive every etag from `await blob.bytes()` in `answerBlob`; each of the three
// answers reads the whole file, 3 x 65536 bytes.
test('a returned file is answered off a stat, a slice and a blob off their bytes — 16.36', async () => {
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
    const ran = Bun.spawnSync(['bun', `${dir}/probe.ts`], { cwd: dir })
    expect(ran.stderr.toString()).toBe('')
    expect(JSON.parse(ran.stdout.toString().trim())).toEqual({
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

// 16.37 — a `Response` the handler built is the answer.
test('a returned Response is answered as it stands — 16.37', async () => {
    const answer = await Bun.fetch(`${base}${RPC}/raw`)
    expect(answer.status).toBe(418)
    expect(await answer.text()).toBe('teapot')
})

// 16.35, 16.36 — A BLOB AT ITS OWN TYPE, RANGE-AWARE: 206 for a range, 416 past the end, 304 for its
// own etag, and the whole body where `If-Range` names another version.
test('a Blob is answered at its type and honors Range — 16.35, 16.36', async () => {
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
