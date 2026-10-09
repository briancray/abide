// 16.49–16.51 — A `GET` OVER A VALUE DECLARING `history`, ANSWERED PER PRODUCTION. Over a served app,
// fetched with bun's own `fetch` from this process; the socket client is a spawned script, for
// socket.test.ts's reason.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { lastLinePrinted, serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BOARD = `import { reactive } from 'abide/server'

export const board = reactive<string>('first', { history: 3, global: true })
`

const SOCKETS = `import { socket } from 'abide/server'
import { board } from '#server/board.ts'

export const boardSocket = socket(board)
`

const FEED = `import { GET, POST } from 'abide/server'
import { board } from '#server/board.ts'

export const feed = GET(board)

export const post = POST(({ text }: { text: string }) => {
    board.publish(text)
})
`

const PAGE = `<script>
import { feed } from '#server/rpc/feed.ts'

const standing = feed()
</script>

<main>{standing()}</main>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'server/board.ts': BOARD,
        'server/sockets/board.ts': SOCKETS,
        'server/rpc/feed.ts': FEED,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

const FEED_ADDRESS = '/__abide/rpc/feed/feed'

function publish(text: string): Promise<Response> {
    return Bun.fetch(`${base}/__abide/rpc/feed/post`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
    })
}

/** A framed answer — lines, or events — read a frame at a time; `undefined` once it has ended. */
function framed(answer: Response): {
    next(): Promise<string | undefined>
    hangUp(): Promise<void>
} {
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    const separator = answer.headers
        .get('content-type')
        ?.startsWith('text/event-stream')
        ? '\n\n'
        : '\n'
    let text = ''
    return {
        async next() {
            for (;;) {
                const at = text.indexOf(separator)
                if (at !== -1) {
                    const frame = text.slice(0, at)
                    text = text.slice(at + separator.length)
                    // An event stream opens on a comment (`bodyOf`).
                    if (frame !== ':') return frame
                    continue
                }
                const { done, value } = await reader.read()
                if (done) return undefined
                text += decoder.decode(value, { stream: true })
            }
        },
        hangUp: () => reader.cancel(),
    }
}

/** The frames `reading` carries next, up to `count` or to the first `until` matches; then hangs up. */
async function framesOf(
    reading: ReturnType<typeof framed>,
    count: number,
    until?: string,
): Promise<string[]> {
    const frames: string[] = []
    while (frames.length < count) {
        const frame = await reading.next()
        if (frame === undefined) break
        frames.push(frame)
        if (until !== undefined && frame.includes(until)) break
    }
    await reading.hangUp()
    return frames
}

type Production = { op: string; seq: number; epoch: string; value: unknown }

// 16.49 — THE RING AND THEN EVERY PRODUCTION LIVE, each framed with its sequence number and epoch.
// THE REVERT: hand the settled value on in `outcomeOf` rather than the value itself; the answer is
// the standing production as JSON, and 0 of the 2 frames arrive.
test('a jsonl reader of a history value is framed each production with its seq and epoch — 16.49', async () => {
    const answer = await Bun.fetch(`${base}${FEED_ADDRESS}`, {
        headers: { accept: 'application/jsonl' },
    })
    expect(answer.headers.get('content-type')).toBe('application/jsonl')
    // The ring's frame read first, so the production after it is published to a reader already
    // live rather than into the ring it is replayed.
    const reading = framed(answer)
    const ring = JSON.parse((await reading.next()) as string) as Production
    await publish('second')
    const live = JSON.parse((await reading.next()) as string) as Production
    await reading.hangUp()
    expect(ring?.op).toBe('prod')
    expect(live?.value).toBe('second')
    expect(live?.seq).toBe((ring?.seq as number) + 1)
    expect(live?.epoch).toBe(ring?.epoch as string)
})

// 16.49, 18.11 — ONE MINTING: the epoch and the sequence number an http reader is framed with are the
// ones a socket subscriber to the same value is sent. THE REVERT: mint the http lane's epoch from a
// map of its own; the two epochs differ, and the seq still agrees — which is why both are asserted.
test('an http reader and a socket subscriber are framed with one epoch and one numbering — 16.49, 18.11', async () => {
    const answer = await Bun.fetch(`${base}${FEED_ADDRESS}`, {
        headers: { accept: 'application/jsonl' },
    })
    // The ring read first, so `shared` is published to a reader already live.
    const opened = framed(answer)
    await opened.next()
    const reading = framesOf(opened, 10, '"value":"shared"')
    await publish('shared')
    const last = JSON.parse((await reading).at(-1) as string) as Production
    // The ring replayed up to `shared`, then the socket closed and drained: a production sent after
    // it, in a numbering of its own, lands ahead of what is said.
    const dir = temporaryModule({
        'client.ts': `const ws = new WebSocket(process.argv[2].replace('http', 'ws') + '/__abide/socket')
const frames: { value?: unknown }[] = []
let replayed = () => {}
const shared = new Promise<void>((done) => (replayed = done))
// A replay is one frame (18.13), read here as the productions it carries.
ws.onmessage = (event) => {
    const frame = JSON.parse(String(event.data))
    const carried = frame.ring === undefined ? [frame] : frame.ring.map(([seq, value]: [number, unknown]) => ({ op: frame.op, seq, epoch: frame.epoch, value }))
    for (const each of carried) {
        frames.push(each)
        if (each.value === 'shared') replayed()
    }
}
await new Promise((done) => (ws.onopen = done))
ws.send(JSON.stringify({ op: 'sub', id: 1, address: '/__abide/socket/board/boardSocket' }))
await Promise.race([shared, new Promise((done) => setTimeout(done, 3000).unref())])
ws.close()
await new Promise((done) => (ws.onclose = done))
console.log(JSON.stringify(frames))
`,
    })
    const socketFrames = await lastLinePrinted<Production[]>([
        'bun',
        `${dir}/client.ts`,
        base,
    ])
    const socketLast = socketFrames.at(-1)
    expect(socketLast?.epoch).toBe(last?.epoch as string)
    expect(socketLast?.seq).toBe(last?.seq as number)
})

// 16.50, 16.51 — AN EVENT STREAM NUMBERS EACH EVENT, and a reconnect naming where it stood is sent
// what came after; one naming another epoch is sent the ring as a reset. THE REVERT: drop the
// `Last-Event-ID` read; the resuming reader is replayed the ring from its oldest, and its first event
// is a production it already had rather than `resumed`.
test('an sse reader is numbered by id, resumes from Last-Event-ID, and is reset on a moved epoch — 16.50, 16.51', async () => {
    const first = await Bun.fetch(`${base}${FEED_ADDRESS}`, {
        headers: { accept: 'text/event-stream' },
    })
    expect(first.headers.get('content-type')).toBe('text/event-stream')
    const opened = framed(first)
    await opened.next()
    const reading = framesOf(opened, 10, 'data: "marker"')
    await publish('marker')
    const id = /^id: (.+)$/m.exec(
        (await reading).at(-1) as string,
    )?.[1] as string
    expect(id).toMatch(/^\d+:[\w-]+$/)
    const [seq, epoch] = id.split(':') as [string, string]

    await publish('resumed')
    const [after] = await framesOf(
        framed(
            await Bun.fetch(`${base}${FEED_ADDRESS}`, {
                headers: { accept: 'text/event-stream', 'last-event-id': id },
            }),
        ),
        1,
    )
    expect(after).toBe(`id: ${Number(seq) + 1}:${epoch}\ndata: "resumed"`)

    const moved = await Bun.fetch(`${base}${FEED_ADDRESS}`, {
        headers: {
            accept: 'text/event-stream',
            'last-event-id': `${seq}:another-epoch`,
        },
    })
    const [reset] = await framesOf(framed(moved), 1)
    expect(reset).toStartWith('event: reset\n')
    const ring = JSON.parse(/^data: (.+)$/m.exec(reset as string)?.[1] ?? '')
    expect(ring.at(-1)).toEqual([Number(seq) + 1, 'resumed'])
})

// 16.31 — A READER ASKING FOR THE VALUE is answered the standing production, as any value is.
test('a reader asking for JSON is answered the standing production — 16.31', async () => {
    await publish('standing')
    const answer = await Bun.fetch(`${base}${FEED_ADDRESS}`)
    expect(answer.headers.get('content-type')).toBe('application/json')
    expect(await answer.json()).toBe('standing')
})

// 16.49 — IN THE SEED BUFFER ALIKE: the browser's call a render left an entry for is framed as a run
// one is. THE REVERT: the same as the first test's — the seeded answer is the JSON value.
test('a seeded answer is framed per production as a run one is — 16.49, 41.13', async () => {
    const page = await Bun.fetch(`${base}/`)
    await page.text()
    const cookie = (page.headers.get('set-cookie') ?? '').split(
        ';',
    )[0] as string
    const answer = await Bun.fetch(`${base}${FEED_ADDRESS}`, {
        headers: { accept: 'application/jsonl', cookie },
    })
    expect(answer.headers.get('server-timing')).toStartWith('Seeded;')
    const [line] = await framesOf(framed(answer), 1)
    expect((JSON.parse(line as string) as Production).op).toBe('prod')
})
