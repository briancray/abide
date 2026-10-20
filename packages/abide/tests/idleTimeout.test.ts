// 16.23, 16.56, 16.57 — WHAT BUN'S IDLE TIMEOUT ENDS, under `abide start`: nothing being answered —
// a slow answer, a stream gone quiet, a follow between changes — and everything else, a body that
// stopped arriving and a kept-alive connection between requests. On the real clock, every case at
// once: the timeout is native, so no fake timer reaches it, and each read has to outlast the ten
// seconds bun reaps at and the fifteen a heartbeat is due by.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { IDLE_TIMEOUT_SECONDS } from '../src/server/IDLE_TIMEOUT_SECONDS.ts'
import { HEARTBEAT_MILLISECONDS } from '../src/server/HEARTBEAT_MILLISECONDS.ts'
import { handlerFiles, serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// Past the moment bun reaps an idle connection, which its four-second tick puts up to four late.
const PAST_REAPING = (IDLE_TIMEOUT_SECONDS + 5) * 1000

const HANDLERS = `import { GET, POST, reactive, sse } from '@abide/abide/server'

const quote = reactive(1, { global: true })

export const price = GET(quote)

export const reprice = POST(() => {
    quote.set(quote() + 1)
})

export const report = GET(async () => {
    await Bun.sleep(${PAST_REAPING})
    return 'done'
})

export const ticks = GET(async function* () {
    yield 1
    await Bun.sleep(${PAST_REAPING})
    yield 2
})

export const beats = GET(() =>
    sse(
        (async function* () {
            yield 1
            await Bun.sleep(${HEARTBEAT_MILLISECONDS + 1000})
            yield 2
        })(),
    ),
)

export const own = GET(
    () =>
        new Response(
            new ReadableStream({
                async start(controller) {
                    controller.enqueue(new TextEncoder().encode('data: 1\\n\\n'))
                    await Bun.sleep(${HEARTBEAT_MILLISECONDS + 1000})
                    controller.enqueue(new TextEncoder().encode('data: 2\\n\\n'))
                    controller.close()
                },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
        ),
)

export const lines = GET(
    () =>
        new Response(
            new ReadableStream({
                async start(controller) {
                    controller.enqueue(new TextEncoder().encode('1\\n'))
                    await Bun.sleep(${PAST_REAPING})
                    controller.enqueue(new TextEncoder().encode('2\\n'))
                    controller.close()
                },
            }),
            { headers: { 'content-type': 'application/x-ndjson' } },
        ),
)

export const echo = POST((args: { text: string }) => args.text)
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'index.abide': '<main>home</main>',
        ...handlerFiles('prices', HANDLERS),
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

/** A response body read as text, whole or as far as the connection carried it. */
async function readAll(
    answer: Promise<Response>,
): Promise<{ text: string; ended: string }> {
    let text = ''
    try {
        const reader = (
            (await answer).body as ReadableStream<Uint8Array>
        ).getReader()
        const decoder = new TextDecoder()
        for (;;) {
            const next = await reader.read()
            if (next.done) return { text, ended: 'done' }
            text += decoder.decode(next.value)
        }
    } catch (thrown) {
        return { text, ended: (thrown as Error).name }
    }
}

/** How long a raw connection stays open after `sent`, up to `deadline` milliseconds. */
function heldFor(sent: string, deadline: number): Promise<number> {
    const port = Number(new URL(base).port)
    return new Promise((done) => {
        const started = Date.now()
        const timer = setTimeout(() => done(deadline), deadline)
        void Bun.connect({
            hostname: '127.0.0.1',
            port,
            socket: {
                open(socket) {
                    socket.write(sent)
                },
                data() {},
                close() {
                    clearTimeout(timer)
                    done(Date.now() - started)
                },
            },
        })
    })
}

// THE REVERT, per row: answer in `releaseScope` without putting the timeout back and the kept-alive
// connection is held for good, `kept` reading the whole deadline; turn it off on arrival rather than
// once received whole and the stalled upload is held the same way; leave it on (drop `unreap`) and the
// slow answer, the quiet stream and the follow each end `ECONNRESET` at 12 seconds; drop
// `beating` from `App.fetch` and `beats` and `own` read no comment between their two events; answer
// a handler's `Response` as it stands rather than `heldUntilSent` and `lines` ends `TypeError` after
// its first line — a stream a handler built itself is held by nothing else.
test('the idle timeout ends what is idle and nothing being answered — 16.23, 16.56, 16.57', async () => {
    const deadline = PAST_REAPING + 3000
    const [report, ticks, lines, beats, own, follow, kept, stalled] =
        await Promise.all([
            readAll(fetch(`${base}/prices/report`)),
            readAll(
                fetch(`${base}/prices/ticks`, {
                    headers: { accept: 'application/jsonl' },
                }),
            ),
            readAll(fetch(`${base}/prices/lines`)),
            readAll(fetch(`${base}/prices/beats`)),
            readAll(fetch(`${base}/prices/own`)),
            followQuietly(),
            heldFor(
                'GET /prices/price HTTP/1.1\r\nHost: app\r\nConnection: keep-alive\r\n\r\n',
                deadline,
            ),
            heldFor(
                'POST /prices/echo HTTP/1.1\r\nHost: app\r\nContent-Type: application/json\r\nContent-Length: 40\r\n\r\n{"text":',
                deadline,
            ),
        ])
    expect({ report, ticks, lines }).toEqual({
        report: { text: '"done"', ended: 'done' },
        ticks: { text: '1\n2\n', ended: 'done' },
        lines: { text: '1\n2\n', ended: 'done' },
    })
    expect(beats.text).toMatch(/^:\n\ndata: 1\n\n:\n\ndata: 2\n\n$/)
    expect(own).toEqual({ text: 'data: 1\n\n:\n\ndata: 2\n\n', ended: 'done' })
    expect(follow).toEqual({ ended: false, beats: 1, changed: true })
    // Reaped, not refused: held to the idle timeout, and no longer than its tick.
    const reaped = { min: IDLE_TIMEOUT_SECONDS * 1000 - 4000, max: deadline }
    for (const held of [kept, stalled]) {
        expect(held).toBeGreaterThan(reaped.min)
        expect(held).toBeLessThan(reaped.max)
    }
}, 40_000)

// 16.57 OVER 18.20 — a follow quiet past a heartbeat, then sent the change that ends the quiet.
async function followQuietly(): Promise<{
    ended: boolean
    beats: number
    changed: boolean
}> {
    const answer = await fetch(`${base}/prices/price`, {
        headers: { accept: 'text/event-stream' },
    })
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let text = ''
    let ended = false
    // ONE READ IN FLIGHT, kept across waits: a read that loses the race to the clock still takes the
    // next chunk, so a fresh one would read past it.
    let pending: ReturnType<typeof reader.read> | undefined
    const readUntil = async (deadline: number, done: () => boolean) => {
        while (!ended && !done() && Date.now() < deadline) {
            pending ??= reader.read()
            const next = await Promise.race([
                pending,
                Bun.sleep(deadline - Date.now()).then(() => undefined),
            ]).catch(() => ({ done: true as const, value: undefined }))
            if (next === undefined) return
            pending = undefined
            if (next.done) ended = true
            else text += decoder.decode(next.value)
        }
    }
    const values = () =>
        text.split('\n\n').filter((block) => block.startsWith('event:'))
    await readUntil(Date.now() + 3000, () => values().length === 1)
    await readUntil(Date.now() + HEARTBEAT_MILLISECONDS + 1000, () => false)
    const beats =
        text.slice(text.indexOf(values()[0] as string)).split(':\n\n').length -
        1
    await fetch(`${base}/prices/reprice`, { method: 'POST' })
    await readUntil(Date.now() + 3000, () => values().length === 2)
    await reader.cancel().catch(() => {})
    return { ended, beats, changed: values().length === 2 }
}
