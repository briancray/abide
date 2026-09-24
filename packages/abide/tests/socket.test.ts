// SECTION 18 — SOCKETS, over a served app. The client is a spawned bun script speaking the mux's frames
// over a real web socket: happy-dom's preload is in this process, and its `WebSocket` is not bun's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
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
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/sockets/chat.ts': SOCKETS,
        'server/board.ts': `import { reactive } from 'abide/server'\n\nexport const board = reactive<string>(undefined, { history: 3, global: true })\n`,
        'server/rpc/chat.ts': HANDLERS,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// Runs `steps` in a bun process against the mux, handing back every frame it received, in order —
// connected from `origin` where one is given.
async function client(
    steps: string,
    origin = '',
): Promise<Record<string, unknown>[]> {
    const dir = temporaryModule({
        'client.ts': `const url = process.argv[2].replace('http', 'ws') + '/__abide/socket'
const frames: unknown[] = []
const ws = new WebSocket(url, process.argv[3] ? { headers: { origin: process.argv[3] } } : undefined)
const send = (frame: unknown) => ws.send(JSON.stringify(frame))
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms))
ws.onmessage = (event) => frames.push(JSON.parse(String(event.data)))
await new Promise((done) => (ws.onopen = done))
${steps}
await settle(150)
ws.close()
console.log(JSON.stringify(frames))
`,
    })
    const ran = Bun.spawn(['bun', `${dir}/client.ts`, base, origin], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const printed = await new Response(ran.stdout).text()
    return JSON.parse(printed.trim().split('\n').at(-1) as string)
}

// 18.2, 18.10, 9.16 — A SUBSCRIPTION IS FED EVERY PRODUCTION, numbered by its owner, and a publish made
// inside a request reaches it. THE REVERT: drop `global` from the room and the refusal from `socket`;
// the handler publishes into the request's own copy, and the subscriber is fed 0 of the 2 productions.
test('a subscriber is fed each production with its sequence number — 18.2, 18.10, 9.16', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room' })
await settle(50)
for (const text of ['hello', 'world'])
    await fetch(process.argv[2] + '/__abide/rpc/chat/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
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
await settle(50)
for (const text of ['one', 'two'])
    await fetch(process.argv[2] + '/__abide/rpc/chat/post', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
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
await settle(50)
send({ op: 'pub', id: 1, address: '/__abide/socket/chat/room', message: 'a' })
send({ op: 'pub', id: 1, address: '/__abide/socket/chat/room', message: 'b' })
`)
    const seen = first.filter((frame) => frame.op === 'prod') as {
        seq: number
        epoch: string
        value: string
    }[]
    const last = seen.at(-1) as { seq: number; epoch: string }
    const resumed =
        await client(`send({ op: 'pub', id: 9, address: '/__abide/socket/chat/room', message: 'c' })
await settle(50)
send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room', seq: ${last.seq}, epoch: '${last.epoch}' })
`)
    expect(
        resumed
            .filter((frame) => frame.op === 'prod')
            .map((frame) => frame.value),
    ).toEqual(['c'])
    const reset =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room', seq: 1, epoch: 'another' })
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
// (`crossing: null` in `connectionOf`); the other origin is fed the room.
test('a connection from another origin is refused a socket that did not declare it — 18.5', async () => {
    const crossing = await client(
        `send({ op: 'sub', id: 1, address: '/__abide/socket/chat/room' })
`,
        'https://elsewhere.test',
    )
    expect(crossing).toEqual([
        { op: 'error', id: 1, error: expect.objectContaining({ status: 403 }) },
    ])
    const own = await client(
        `send({ op: 'sub', id: 1, address: '/__abide/socket/chat/locked', args: { token: 'ok' } })
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
await settle(200)
const other = (socketWire('/__abide/socket/chat/room') as () => any)
console.log(JSON.stringify({ busyAtFirst, busyAfter: room.busy(), latest: room(), same: other() === other() }))
process.exit(0)
`,
    })
    const ran = Bun.spawn(['bun', `${dir}/browser.ts`, base], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const printed = await new Response(ran.stdout).text()
    expect(JSON.parse(printed.trim().split('\n').at(-1) as string)).toEqual({
        busyAtFirst: true,
        busyAfter: false,
        latest: 'from the browser',
        same: true,
    })
    const owner = await Bun.fetch(`${base}/__abide/rpc/chat/latest`)
    expect(await owner.json()).toBe('from the browser')
})
