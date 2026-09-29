// 18.17, 18.20–18.23 — A `GET` FOLLOWED OVER THE MUX. The client is a spawned bun script speaking the
// mux's frames over a real web socket, for `socket.test.ts`'s reason: happy-dom's preload is in this
// process, and its `WebSocket` is not bun's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const HANDLERS = `import { GET, POST, reactive, refuse } from 'abide/server'

const shelf = reactive<string[]>(['dune'], { global: true })

export const books = GET(shelf)

export const shelve = POST(({ title }: { title: string }) => {
    shelf.set([...shelf(), title])
})

export const rename = POST(({ at, title }: { at: number; title: string }) => {
    shelf.patch((titles) => {
        titles[at] = title
    })
})

export const shuffle = POST(() => {
    shelf.patch((titles) => {
        titles.sort((a, b) => b.localeCompare(a))
    })
})

export const contact = GET(({ id }: { id: number }) => ({ id, at: Date.now() }))

export const touch = POST(({ id, refresh }: { id: number; refresh?: boolean }) => {
    if (refresh) contact.refresh({ id })
    else contact.invalidate({ id })
})

let priced = 0
const prices = reactive(({ id }: { id: number }) => ({ id, priced: priced++ }), { global: true })

export const price = GET(prices)

export const reprice = POST(({ id, refresh }: { id?: number; refresh?: boolean }) => {
    const pattern = id === undefined ? undefined : { id }
    if (refresh) price.refresh(pattern)
    else price.invalidate(pattern)
})

export const locked = GET(shelf, {
    middleware: [
        async (next, { request }) => {
            if (request.headers.get('x-token') !== 'ok') throw refuse(401, 'no token')
            return next()
        },
    ],
})

export const touchLocked = POST(() => {
    locked.invalidate()
})

let restocked = 0
const stock = reactive(() => ({ restocked: restocked++ }), { global: true })

export const level = GET(stock)

export const restock = POST(() => {
    stock.invalidate()
})
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/library.ts': HANDLERS,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// Runs `steps` in a bun process against the mux, handing back every frame it received, in order.
// `get` and `post` call the app over http.
async function client(steps: string): Promise<Record<string, unknown>[]> {
    const dir = temporaryModule({
        'client.ts': `const base = process.argv[2]
const frames: unknown[] = []
const ws = new WebSocket(base.replace('http', 'ws') + '/__abide/socket')
const send = (frame: unknown) => ws.send(JSON.stringify(frame))
const settle = (ms: number) => new Promise((done) => setTimeout(done, ms))
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + '/__abide/rpc/library/' + path, { headers })
const post = (path: string, body: unknown) => fetch(base + '/__abide/rpc/library/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
ws.onmessage = (event) => frames.push(JSON.parse(String(event.data)))
await new Promise((done) => (ws.onopen = done))
${steps}
await settle(150)
ws.close()
console.log(JSON.stringify(frames))
`,
    })
    const ran = Bun.spawn(['bun', `${dir}/client.ts`, base], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const printed = await new Response(ran.stdout).text()
    return JSON.parse(printed.trim().split('\n').at(-1) as string)
}

const ops = (frames: Record<string, unknown>[]): unknown[] =>
    frames.map((frame) => frame.op)

// 18.20, 18.21 — THE ANSWER NAMES ITS VERSION, and a follower naming it is sent nothing until the value
// moves. THE REVERT: send the value in `follow` whatever version was named; the follower is handed the
// shelf it already has as well, 2 values where 1 is due.
test('a follower naming the answered version is sent only what changes after it', async () => {
    const frames = await client(`const answered = await get('books')
const version = Number(answered.headers.get('abide-version'))
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books', version })
await settle(50)
await post('shelve', { title: 'emma' })
`)
    const values = frames.filter((frame) => frame.op === 'value')
    expect(values.map((frame) => frame.value)).toHaveLength(1)
    expect((values.at(-1) as { value: string[] }).value.at(-1)).toBe('emma')
})

// 18.21 — A FOLLOWER NAMING NO VERSION, or a stale one, is handed what stands.
test('a follower naming no version is handed the value standing', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books' })
`)
    expect(ops(frames)).toEqual(['value'])
    expect((frames[0] as { value: string[] }).value[0]).toBe('dune')
    expect(typeof (frames[0] as { version: number }).version).toBe('number')
})

// 18.22, 18.26 — A PATCH IS A NEW VERSION although it moves no ordinal (5.7), and a follower standing
// at the version it was written over is sent the writes, not the shelf. THE REVERT: return
// `undefined` from `patchFrom`; the follower is sent the whole shelf as a value, and no patch.
test('a patch reaches a follower as what it wrote, over the version it held', async () => {
    const frames = await client(`const answered = await get('books')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books', version: Number(answered.headers.get('abide-version')) })
await settle(50)
await post('rename', { at: 0, title: 'dune messiah' })
`)
    expect(ops(frames)).toEqual(['patch'])
    const patch = frames[0] as {
        base: number
        version: number
        ops: unknown[]
    }
    expect(patch.ops).toEqual([{ path: [0], set: 'dune messiah' }])
    expect(patch.version).toBeGreaterThan(patch.base)
})

// 18.28 — WHAT CANNOT BE SENT AS WRITES IS SENT AS THE VALUE: a sort by a comparator, which no frame
// can carry. THE REVERT: drop the comparator check in `recordWrites`; the follower is sent a
// `sort` call with no arguments, which on the other side sorts by a different order.
test('a patch that cannot be sent as writes is sent as the value', async () => {
    const frames = await client(`const answered = await get('books')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books', version: Number(answered.headers.get('abide-version')) })
await settle(50)
await post('shuffle', {})
`)
    expect(ops(frames)).toEqual(['value'])
})

// 7.10, 13.12 — A TRIGGER ON THE SERVER REACHES THE FOLLOWERS ITS PATTERN NAMES, over a value built per
// request, which is fed nothing. THE REVERT: drop the `RPC_SERVER.broadcast` call from `rpc.ts`; the
// follower of id 2 is sent 0 frames.
test('an invalidate on the server reaches the followers its pattern names', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/rpc/library/contact', args: { id: 1 } })
send({ op: 'sub', id: 2, address: '/__abide/rpc/library/contact', args: { id: 2 } })
await settle(50)
await post('touch', { id: 2 })
`)
    expect(frames).toEqual([{ op: 'invalidate', id: 2 }])
})

// 7.18 — the same for a refresh, over a value no production of which is fed.
test('a refresh on the server reaches the followers its pattern names', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 2, address: '/__abide/rpc/library/contact', args: { id: 2 } })
await settle(50)
await post('touch', { id: 2, refresh: true })
`)
    expect(frames).toEqual([{ op: 'refresh', id: 2 }])
})

// 7.10 — AN INVALIDATE OF THE VALUE A \`GET\` SERVES reaches the browsers following it, as
// \`rpc.invalidate\` does: the trigger is the value's, not the \`Rpc\`'s. THE REVERT: broadcast from the
// \`Rpc\`'s members alone; the follower is sent no frame.
test("the value's own invalidate reaches the followers of the GET serving it — 7.10", async () => {
    const frames = await client(`const answered = await get('level')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/level', version: Number(answered.headers.get('abide-version')) })
await settle(50)
await post('restock', {})
await settle(50)
`)
    expect(ops(frames)).toEqual(['invalidate'])
})

// 18.23 — A GUARDED HANDLER IS FOLLOWED FOR ITS TRIGGERS AND NEVER FED: its rungs run per request, and
// a value pushed past them is data they never saw. THE REVERT: drop `rpc.guarded` from `follow`; the
// follower is handed the shelf with no token.
test('a guarded handler is followed for its triggers and never fed', async () => {
    const frames = await client(`await get('locked', { 'x-token': 'ok' })
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/locked' })
await settle(50)
await post('shelve', { title: 'persuasion' })
await post('touchLocked', {})
`)
    expect(ops(frames)).toEqual(['invalidate'])
})

// 7.10, 7.18, 13.12 — A \`global\` \`GET\` TRIGGERED FROM INSIDE ANOTHER REQUEST, by its args: a request-local
// handler reaches the browsers following the entries its pattern names, and no others — the refreshed
// entry's copy is fed its reload, and the invalidated one is told. THE REVERT: drop the \`FOLLOWED\` call
// from \`invalidateOne\`; the second follower is sent nothing.
test('a global GET triggered by args from inside another request reaches the followers its pattern names', async () => {
    const frames = await client(`const one = await get('price?id=1')
const two = await get('price?id=2')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/price', args: { id: 1 }, version: Number(one.headers.get('abide-version')) })
send({ op: 'sub', id: 2, address: '/__abide/rpc/library/price', args: { id: 2 }, version: Number(two.headers.get('abide-version')) })
await settle(50)
await post('reprice', { id: 1, refresh: true })
await settle(50)
await post('reprice', { id: 2 })
await settle(50)
`)
    const seen: unknown[] = []
    for (const frame of frames) seen.push([frame.op, frame.id])
    expect(seen).toEqual([
        ['value', 1],
        ['invalidate', 2],
    ])
})

// 13.12 — NO PATTERN IS EVERY ENTRY, so the same trigger with none reaches every browser following the
// \`GET\`, whatever args each named. THE REVERT: have \`matchesPattern\` answer \`false\` for no pattern;
// neither follower is told.
test('a global GET triggered with no pattern from inside another request reaches every follower', async () => {
    const frames = await client(`const one = await get('price?id=3')
const two = await get('price?id=4')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/price', args: { id: 3 }, version: Number(one.headers.get('abide-version')) })
send({ op: 'sub', id: 2, address: '/__abide/rpc/library/price', args: { id: 4 }, version: Number(two.headers.get('abide-version')) })
await settle(50)
await post('reprice', {})
await settle(50)
`)
    const seen: unknown[] = []
    for (const frame of frames) seen.push([frame.op, frame.id])
    expect(seen).toEqual([
        ['invalidate', 1],
        ['invalidate', 2],
    ])
})

// 18.23 — A FOLLOWER SUBSCRIBED BEFORE ITS ENTRY EXISTED is fed from the entry once an answer makes
// it, rather than told of every change and left to fetch it. THE REVERT: decide what a follower is
// fed from once, at `follow`; it is sent the refresh trigger alone (['refresh'] against two values).
test('a follower of args no entry held yet is fed once an answer makes one', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/rpc/library/price', args: { id: 9 } })
await settle(50)
await get('price?id=9')
await settle(50)
await post('reprice', { id: 9, refresh: true })
await settle(50)
`)
    expect(ops(frames)).toEqual(['value', 'value'])
})
