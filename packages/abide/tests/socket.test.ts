// SECTION 18 — SOCKETS, over a served app. The client is a spawned bun script speaking the mux's frames
// over a real web socket: happy-dom's preload is in this process, and its `WebSocket` is not bun's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { BIN, lastLinePrinted, serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const SOCKETS = `import { reactive, refuse, socket } from 'abide/server'
import { board } from '#server/board.ts'

export const room = socket(reactive<string>(undefined, { history: 3, global: true }), {
    clientPublish: true,
})

export const quiet = socket(reactive<string>(undefined, { history: 3, global: true }))

export const boardSocket = socket(board)

export const locked = socket(reactive<string>('secret', { global: true }), {
    middleware: [
        async (next, event) => {
            if ((event.args as { token?: string } | undefined)?.token !== 'ok') throw refuse(401, 'no token')
            return next()
        },
    ],
})
`

// A handler publishing into the room, inside a request — 9.16's case: the value is still the one the
// subscribers are fed from, and not a copy filed under the request.
const HANDLERS = `import { GET, POST } from 'abide/server'
import { room } from '#server/sockets/chat.ts'
import { board } from '#server/board.ts'

export const say = POST(({ text }: { text: string }) => {
    room().publish(text)
})

export const latest = GET(() => room()())

export const post = POST(({ text }: { text: string }) => {
    board.publish(text)
})

// Answers anything, an upgrade included, with the status the lane admits the mux with.
export const nothing = GET(() => new Response(null, { status: 204 }))
`

// 37.3 — an app rung that refuses a request it can tell by a header, the mux's upgrade included.
const APP = `import { middleware } from 'abide/server'

middleware(async (next, { request }) => {
    if (request.headers.get('x-denied') !== null) return new Response('denied', { status: 401 })
    return next()
})
`

let app = ''
let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ app, base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/sockets/chat.ts': SOCKETS,
        'server/board.ts': `import { reactive } from 'abide/server'\n\nexport const board = reactive<string>(undefined, { history: 3, global: true })\n`,
        'server/rpc/chat.ts': HANDLERS,
        'server/app.ts': APP,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// Runs `steps` in a bun process against the mux, handing back every frame it received, in order —
// connected from `origin` where one is given. Sequenced as `follow.test.ts`'s client is, by the mux
// rather than the clock: `settled()` is a subscription to an address nothing answers, refused as the
// mux reads it, and `until` waits on a frame the test is owed; then the socket is closed and
// drained, so a frame sent before the server took the close lands ahead of what is said. A replay's
// one frame is recorded as the productions it carries.
async function client(
    steps: string,
    origin = '',
): Promise<Record<string, unknown>[]> {
    const dir = temporaryModule({
        'client.ts': `const url = process.argv[2].replace('http', 'ws') + '/__abide/socket'
type Frame = Record<string, unknown>
const frames: Frame[] = []
const ws = new WebSocket(url, process.argv[3] ? { headers: { origin: process.argv[3] } } : undefined)
const send = (frame: unknown) => ws.send(JSON.stringify(frame))
const BARRIER = 1000
let barrier = BARRIER
const refused = new Map<number, () => void>()
const settled = () =>
    new Promise<void>((done) => {
        barrier += 1
        refused.set(barrier, done)
        send({ op: 'sub', id: barrier, address: '/__abide/socket/chat/nothingAnswersHere' })
    })
let arrived = () => {}
const until = async (owed: (frames: Frame[]) => boolean) => {
    const deadline = Date.now() + 3000
    while (!owed(frames) && Date.now() < deadline)
        await new Promise<void>((done) => {
            arrived = done
            setTimeout(done, 50).unref()
        })
}
ws.onmessage = (event) => {
    const frame = JSON.parse(String(event.data)) as Frame
    if (frame.op === 'error' && (frame.id as number) > BARRIER) {
        refused.get(frame.id as number)?.()
        return
    }
    // A REPLAY IS ONE FRAME (18.13); read here as the productions it carries, one frame each.
    if (frame.op === 'prod' && Array.isArray(frame.ring))
        for (const [seq, value] of frame.ring as [number, unknown][])
            frames.push({ op: 'prod', id: frame.id, seq, epoch: frame.epoch, value })
    else frames.push(frame)
    arrived()
}
await new Promise((done) => (ws.onopen = done))
${steps}
await settled()
ws.close()
await new Promise((done) => (ws.onclose = done))
console.log(JSON.stringify(frames))
`,
    })
    return lastLinePrinted(['bun', `${dir}/client.ts`, base, origin])
}

// 18.2, 18.10, 9.16 — A SUBSCRIPTION IS FED EVERY PRODUCTION, numbered by its owner, and a publish made
// inside a request reaches it. THE REVERT: drop `global` from the room and the refusal from `socket`;
// the handler publishes into the request's own copy, and the subscriber is fed 0 of the 2 productions.
test('a subscriber is fed each production with its sequence number — 18.2, 18.10, 9.16', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room' })
await settled()
for (const text of ['hello', 'world'])
    await fetch(process.argv[2] + '/__abide/rpc/chat/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
await until((frames) => frames.some((frame) => frame.value === 'world'))
`)
    const produced = frames.filter((frame) => frame.op === 'prod')
    expect(produced.map((frame) => frame.value)).toEqual(['hello', 'world'])
    const [first, second] = produced as { seq: number; epoch: string }[]
    expect((second as { seq: number }).seq).toBe(
        (first as { seq: number }).seq + 1,
    )
    expect(typeof (first as { epoch: string }).epoch).toBe('string')
})

// 9.16 — THE AUTHOR'S OWN BINDING, published into inside a request, reaches the subscribers too.
// THE REVERT: drop `global` from the board and the refusal from `socket`; the request's own copy of
// the board is published into and the subscriber is fed 0 of the 2 productions.
test('a publish through the value the socket was handed reaches its subscribers — 9.16', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/socket/chat/boardSocket' })
await settled()
for (const text of ['one', 'two'])
    await fetch(process.argv[2] + '/__abide/rpc/chat/post', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
await until((frames) => frames.some((frame) => frame.value === 'two'))
`)
    expect(
        frames
            .filter((frame) => frame.op === 'prod')
            .map((frame) => frame.value),
    ).toEqual(['one', 'two'])
})

// 18.13, 18.14 — A RECONNECT RESUMES AFTER THE LAST SEQUENCE IT SAW under the same epoch, and is handed
// the ring marked a reset under another. THE REVERT: ignore `seq` in `subscribe`; the resumed
// subscriber is replayed the whole ring, productions it had already rendered included.
test('a reconnect resumes after its last sequence, and a moved epoch is a reset — 18.13, 18.14', async () => {
    const first =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room' })
await settled()
send({ op: 'pub', id: 1, address: '/__abide/socket/chat/room', message: 'a' })
send({ op: 'pub', id: 1, address: '/__abide/socket/chat/room', message: 'b' })
await until((frames) => frames.some((frame) => frame.value === 'b'))
`)
    const seen = first.filter((frame) => frame.op === 'prod') as {
        seq: number
        epoch: string
        value: string
    }[]
    const last = seen.at(-1) as { seq: number; epoch: string }
    const resumed =
        await client(`send({ op: 'pub', id: 9, address: '/__abide/socket/chat/room', message: 'c' })
await settled()
send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room', seq: ${last.seq}, epoch: '${last.epoch}' })
await until((frames) => frames.some((frame) => frame.value === 'c'))
`)
    expect(
        resumed
            .filter((frame) => frame.op === 'prod')
            .map((frame) => frame.value),
    ).toEqual(['c'])
    const reset =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room', seq: 1, epoch: 'another' })
await until((frames) => frames.length > 0)
`)
    const [resetFrame] = reset as { op: string; ring: [number, string][] }[]
    expect(resetFrame?.op).toBe('reset')
    // The whole ring — what an earlier test published included — bounded by `history` beside the
    // standing production, and ending with this test's three.
    const ring = (resetFrame as { ring: [number, string][] }).ring.map(
        ([, value]) => value,
    )
    expect(ring.length).toBeLessThanOrEqual(4)
    expect(ring.slice(-3)).toEqual(['a', 'b', 'c'])
})

// 18.6, 18.7 — A PUBLISH FROM OUTSIDE IS REFUSED unless the socket admitted it.
test('a client publish is refused where clientPublish is not declared — 18.6', async () => {
    const frames =
        await client(`send({ op: 'pub', id: 3, address: '/__abide/socket/chat/quiet', message: 'nope' })
`)
    expect(frames).toEqual([
        { op: 'error', id: 3, error: expect.objectContaining({ status: 403 }) },
    ])
})

// 18.5 — A CONNECTION FROM ANOTHER ORIGIN IS CLOSED OUT of a socket that did not declare it, and the
// app's own origin is not. THE REVERT: read the connection as the app's own whatever its `Origin`
// (`crossing: null` in `MuxConnection`); the other origin is fed the room.
test('a connection from another origin is refused a socket that did not declare it — 18.5', async () => {
    const crossing = await client(
        `send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room' })
`,
        'https://elsewhere.test',
    )
    expect(crossing).toEqual([
        { op: 'error', id: 1, error: expect.objectContaining({ status: 403 }) },
    ])
    // 18.17 — and a handler followed over the mux, through the handler's own gate (16.25).
    const followed = await client(
        `send({ op: 'sub', id: 2, address: '/__abide/rpc/chat/latest' })
`,
        'https://elsewhere.test',
    )
    expect(followed).toEqual([
        { op: 'error', id: 2, error: expect.objectContaining({ status: 403 }) },
    ])
    const own = await client(
        `send({ op: 'sub', id: 1, address: '/__abide/socket/chat/locked', args: { token: 'ok' } })
await until((frames) => frames.length > 0)
`,
        base,
    )
    expect(own.map((frame) => frame.value)).toEqual(['secret'])
})

// 18.3, 18.4 — A RUNG REFUSES A SUBSCRIPTION BY THROWING, and one that passes is fed.
test('a socket rung refuses a subscription by throwing — 18.3, 18.4', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/socket/chat/locked', args: { token: 'no' } })
send({ op: 'sub', id: 2, address: '/__abide/socket/chat/locked', args: { token: 'ok' } })
await until((frames) => frames.length >= 2)
`)
    expect(frames).toContainEqual({
        op: 'error',
        id: 1,
        error: expect.objectContaining({ status: 401, message: 'no token' }),
    })
    expect(
        frames.filter((frame) => frame.id === 2).map((frame) => frame.value),
    ).toEqual(['secret'])
})

// 37.3 — THE APP LANE RUNS OVER THE MUX'S UPGRADE as over any request, so a connection its rung
// refused is never opened — and with it every `GET` the mux would have followed past that rung.
// THE REVERT: upgrade in `listen`'s `fetch` before asking `fetch`; the refused connection opens.
test('an app rung that refuses the upgrade keeps the mux closed — 37.3', async () => {
    const dir = temporaryModule({
        'upgrade.ts': `const url = process.argv[2].replace('http', 'ws') + '/__abide/socket'
const opened = async (headers: Record<string, string>) => {
    const ws = new WebSocket(url, { headers })
    const outcome = await new Promise<string>((done) => {
        ws.onopen = () => done('open')
        ws.onerror = () => done('refused')
    })
    ws.close()
    return outcome
}
console.log(JSON.stringify([await opened({}), await opened({ 'x-denied': '1' })]))
`,
    })
    expect(
        await lastLinePrinted<string[]>(['bun', `${dir}/upgrade.ts`, base]),
    ).toEqual(['open', 'refused'])
})

// 37.3 — THE MUX OPENS ONLY AT ITS OWN ADDRESS, whatever status some other address answered an upgrade
// with. THE REVERT: drop the address from `admitsMux`; the handler's 204 opens a mux connection at its
// address, and this reads ['open', 'open'].
test('an upgrade some other address answers 204 opens nothing — 37.3', async () => {
    const dir = temporaryModule({
        'upgrade.ts': `const base = process.argv[2].replace('http', 'ws')
const opened = async (address: string) => {
    const ws = new WebSocket(base + address)
    const outcome = await new Promise<string>((done) => {
        ws.onopen = () => done('open')
        ws.onerror = () => done('refused')
    })
    ws.close()
    return outcome
}
console.log(JSON.stringify([await opened('/__abide/socket'), await opened('/__abide/rpc/chat/nothing')]))
`,
    })
    expect(
        await lastLinePrinted<string[]>(['bun', `${dir}/upgrade.ts`, base]),
    ).toEqual(['open', 'refused'])
})

// 9.29, 18.6 — THE BROWSER'S COPY, through `socketWire` itself: busy until the first production lands,
// then fed each one, and a publish made on it sent to the owner and fed back once the owner took it.
// THE REVERT: publish into the copy locally rather than sending it; the copy reads it, and the owner
// still answers what it held before.
test("a subscriber's copy is busy until fed, and its publish reaches the owner — 9.29, 18.6", async () => {
    const dir = temporaryModule({
        'browser.ts': `;(globalThis as { location?: URL }).location = new URL(process.argv[2])
const { socketWire } = await import('abide/wire')
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms))
const room = (socketWire('/__abide/socket/chat/room') as () => any)()
const busyAtFirst = room.busy()
room.publish('from the browser')
// Until the owner's production comes back, rather than for as long as that usually takes.
const deadline = Date.now() + 3000
while ((room.busy() || room() !== 'from the browser') && Date.now() < deadline) await settle(10)
const other = (socketWire('/__abide/socket/chat/room') as () => any)
console.log(JSON.stringify({ busyAtFirst, busyAfter: room.busy(), latest: room(), same: other() === other() }))
process.exit(0)
`,
    })
    expect(
        await lastLinePrinted<Record<string, unknown>>([
            'bun',
            `${dir}/browser.ts`,
            base,
        ]),
    ).toEqual({
        busyAtFirst: true,
        busyAfter: false,
        latest: 'from the browser',
        same: true,
    })
    const owner = await Bun.fetch(`${base}/__abide/rpc/chat/latest`)
    expect(await owner.json()).toBe('from the browser')
})

// 18.2 — A MUX CONNECTION OPENED IS A LINE ON `abide:socket`, under `abide start` as under the mux alone.
// THE REVERT: override the listener's `open` without calling the mux's; 0 lines where there was 1.
test('abide start logs each mux connection on abide:socket — 18.2', async () => {
    const server = Bun.spawn(
        [
            'bun',
            BIN,
            'start',
            '--root',
            app,
            '--out',
            `${app}/.abide`,
            '--port',
            '0',
        ],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, DEBUG: 'abide:socket' },
        },
    )
    try {
        const reader = (server.stdout as ReadableStream<Uint8Array>).getReader()
        let seen = ''
        let address: RegExpExecArray | null = null
        while (address === null) {
            const { value, done } = await reader.read()
            if (done) throw new Error(`abide start printed no address: ${seen}`)
            seen += new TextDecoder().decode(value)
            address = /http:\/\/[^\s]+/.exec(seen)
        }
        const url = new URL(address[0])
        const opened = Bun.spawn(
            [
                'bun',
                '-e',
                `const ws = new WebSocket(${JSON.stringify(`ws://${url.host}/__abide/socket`)}); ws.onopen = () => { ws.close(); process.exit(0) }`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        await opened.exited
        while (!/abide:socket.*open/.test(seen)) {
            const { value, done } = await Promise.race([
                reader.read(),
                Bun.sleep(2_000).then(() => ({ value: undefined, done: true })),
            ])
            if (done) break
            seen += new TextDecoder().decode(value)
        }
        expect(seen.match(/abide:socket.*open/g)?.length ?? 0).toBe(1)
    } finally {
        server.kill()
    }
})
