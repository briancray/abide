// 18.3, 18.5–18.8 — A `GET` FOLLOWED OVER THE MUX. The client is a spawned bun script speaking the
// mux's frames over a real web socket: happy-dom's preload is in this process, and its `WebSocket`
// is not bun's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { BIN, lastLinePrinted, serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const HANDLERS = `import { GET, invalidate, log, POST, reactive, refresh, refuse } from 'abide/server'

const shelf = reactive<string[]>(['dune'], { global: true })

export const books = GET(shelf)

export const note = POST(({ text }: { text: string }) => {
    log(text)
})

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

export const shows = GET(() => ({ at: Date.now() }), { tags: ['library'] })

export const films = GET(() => ({ at: performance.now() }), { global: true, tags: ['catalog'] })

export const recatalog = POST(() => {
    refresh({ tags: ['catalog'] })
})

export const rescan = POST(({ refresh: reload, bare }: { refresh?: boolean; bare?: boolean }) => {
    const selection = bare ? undefined : { tags: ['library'] }
    if (reload) refresh(selection)
    else invalidate(selection)
})
`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp(
        {
            'ui/pages/page.abide': '<main>home</main>',
            'server/rpc/library.ts': HANDLERS,
        },
        { ...process.env, ABIDE_LOGS: '1' },
    ))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// Runs `steps` in a bun process against the mux, handing back every frame it received, in order.
// `get` and `post` call the app over http. NOTHING IS SEQUENCED BY THE CLOCK: `settled()` sends a
// subscription to an address nothing answers, which the mux refuses as it reads it, so its refusal
// coming back says every frame sent before it has been taken; `until` waits on a frame the test is
// owed. Then a last `settled()`, and the socket closed and drained, so a frame the server sent
// before it took the close — one too many, which is what most of these are about — lands ahead
// of what is said.
async function client(
    steps: string,
    upgrade: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
    const dir = temporaryModule({
        'client.ts': `const base = process.argv[2]
type Frame = Record<string, unknown>
const frames: Frame[] = []
const ws = new WebSocket(base.replace('http', 'ws') + '/__abide/socket', { headers: ${JSON.stringify(upgrade)} } as never)
const send = (frame: unknown) => ws.send(JSON.stringify(frame))
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + '/__abide/rpc/library/' + path, { headers })
const post = (path: string, body: unknown) => fetch(base + '/__abide/rpc/library/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const BARRIER = 1000
let barrier = BARRIER
const refused = new Map<number, () => void>()
const settled = () =>
    new Promise<void>((done) => {
        barrier += 1
        refused.set(barrier, done)
        send({ op: 'sub', id: barrier, address: '/__abide/rpc/library/nothingAnswersHere' })
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
    frames.push(frame)
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
    return lastLinePrinted(['bun', `${dir}/client.ts`, base])
}

const ops = (frames: Record<string, unknown>[]): unknown[] =>
    frames.map((frame) => frame.op)

// 18.5, 18.6 — THE ANSWER NAMES ITS VERSION, and a follower naming it is sent nothing until the value
// moves. THE REVERT: send the value in `follow` whatever version was named; the follower is handed the
// shelf it already has as well, 2 values where 1 is due.
test('a follower naming the answered version is sent only what changes after it', async () => {
    const frames = await client(`const answered = await get('books')
const version = Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, ''))
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books', version })
await settled()
await post('shelve', { title: 'emma' })
await until((frames) => frames.some((frame) => frame.op === 'value'))
`)
    const values = frames.filter((frame) => frame.op === 'value')
    expect(values.map((frame) => frame.value)).toHaveLength(1)
    expect((values.at(-1) as { value: string[] }).value.at(-1)).toBe('emma')
})

// 18.19 — A READER HOLDING THE VERSION STANDING IS ANSWERED 304 AND NO BODY, and one holding an older
// version is answered the value. THE REVERT: drop the `If-None-Match` arm in `answerOutcome`; the
// first re-read is 200 with the whole shelf again.
test('a GET naming the version it holds is answered 304, and one the value moved past 200 — 18.19', async () => {
    const frames = await client(`const first = await get('books')
const etag = String(first.headers.get('etag'))
const same = await get('books', { 'if-none-match': etag })
frames.push({ op: 'same', status: same.status, body: await same.text(), etag: same.headers.get('etag') === etag })
await post('shelve', { title: 'persuasion' })
const moved = await get('books', { 'if-none-match': etag })
frames.push({ op: 'moved', status: moved.status, etag: moved.headers.get('etag') === etag })
`)
    expect(frames).toEqual([
        { op: 'same', status: 304, body: '', etag: true },
        { op: 'moved', status: 200, etag: false },
    ])
})

// 18.20 — A GET ASKED FOR AN EVENT STREAM IS FOLLOWED OVER SSE, each mux frame one event: the value
// with its version as the event `id`, then a patch as JSON Patch over the id before it. And an
// `EventSource` reconnecting with that id as `Last-Event-ID` is sent nothing until the value moves.
// THE REVERT: drop the event-stream arm in `answerOutcome`; the reader is answered the shelf once,
// as JSON, and no event follows.
test('a GET asked for an event stream is followed, and resumes from Last-Event-ID — 18.20', async () => {
    const frames = await client(`const decoder = new TextDecoder()
const follow = async (headers: Record<string, string>, act: () => Promise<unknown>) => {
    const answer = await get('books', { accept: 'text/event-stream', ...headers })
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    let text = ''
    const events = () => text.split('\\n\\n').filter((block) => block.startsWith('event:'))
    const until = async (count: number) => {
        const deadline = Date.now() + 3000
        while (events().length < count && Date.now() < deadline) {
            const next = await Promise.race([reader.read(), Bun.sleep(3000).then(() => ({ done: true, value: undefined }))])
            if (next.done) break
            text += decoder.decode(next.value)
        }
    }
    await until(headers['last-event-id'] === undefined ? 1 : 0)
    await act()
    await until(headers['last-event-id'] === undefined ? 2 : 1)
    await reader.cancel()
    return { type: answer.headers.get('content-type'), events: events() }
}
const first = await follow({}, () => post('rename', { at: 0, title: 'children of dune' }))
frames.push({ op: 'first', ...first })
const held = /id: (\\d+)/.exec(first.events.at(-1) ?? '')?.[1] ?? ''
const resumed = await follow({ 'last-event-id': held }, () => post('rename', { at: 0, title: 'chapterhouse' }))
frames.push({ op: 'resumed', ...resumed })
// The shelf is the file's: put its first title back for the tests after this one.
await post('rename', { at: 0, title: 'dune' })
`)
    const [first, resumed] = frames as {
        type: string
        events: string[]
    }[]
    expect(first?.type).toBe('text/event-stream')
    expect(first?.events[0]).toMatch(/^event: value\nid: \d+\ndata: \[/)
    expect(first?.events[1]).toMatch(
        /^event: patch\nid: \d+\ndata: \[{"op":"replace","path":"\/0","value":"children of dune"}\]$/,
    )
    expect(resumed?.events).toHaveLength(1)
    expect(resumed?.events[0]).toMatch(
        /^event: patch\nid: \d+\ndata: .*chapterhouse/,
    )
})

// 38.70 OVER 18.20 — `abide watch` GIVEN A GET FOLLOWS IT AS AN EVENT STREAM, the client any terminal
// is: the value, then the value again after a patch, replayed from the JSON Patch it was sent. THE
// REVERT: answer a 404 from the mux as a refusal rather than following the address as a `GET`;
// nothing prints.
test('abide watch follows a GET over its event stream — 38.70, 18.20', async () => {
    const watcher = Bun.spawn(
        ['bun', BIN, 'watch', 'library/books', '--url', base],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    try {
        const reader = (
            watcher.stdout as ReadableStream<Uint8Array>
        ).getReader()
        let seen = ''
        const lines = (): string[] =>
            seen.split('\n').filter((line) => line !== '')
        const until = async (count: number): Promise<void> => {
            while (lines().length < count) {
                const { value, done } = await Promise.race([
                    reader.read(),
                    Bun.sleep(5_000).then(() => ({
                        value: undefined,
                        done: true,
                    })),
                ])
                if (done) return
                seen += new TextDecoder().decode(value)
            }
        }
        await until(1)
        const before = JSON.parse(lines()[0] as string) as string[]
        const renamed = await spawned([
            'bun',
            BIN,
            'call',
            'library/rename',
            '{"at":0,"title":"watched"}',
            '--url',
            base,
        ])
        expect(renamed.exitCode).toBe(0)
        await until(2)
        expect(JSON.parse(lines()[1] ?? 'null')).toEqual([
            'watched',
            ...before.slice(1),
        ])
    } finally {
        watcher.kill()
        await spawned([
            'bun',
            BIN,
            'call',
            'library/rename',
            '{"at":0,"title":"dune"}',
            '--url',
            base,
        ])
    }
})

// 18.8 OVER SSE — A GUARDED GET IS FOLLOWED once the request opening the stream passes its rungs, and
// a request they refuse is answered the refusal, not a stream. THE REVERT: withhold the \`ETag\` from a
// guarded \`GET\` in \`answerOutcome\`; the admitted reader is answered the shelf once, as JSON.
test('a guarded GET streams to a reader its rungs admit, and refuses the rest — 18.8, 18.20', async () => {
    const frames = await client(`const decoder = new TextDecoder()
const admitted = await get('locked', { accept: 'text/event-stream', 'x-token': 'ok' })
const reader = (admitted.body as ReadableStream<Uint8Array>).getReader()
let text = ''
const events = () => text.split('\\n\\n').filter((block) => block.startsWith('event:'))
const read = async (count: number) => {
    const deadline = Date.now() + 3000
    while (events().length < count && Date.now() < deadline) {
        const next = await Promise.race([reader.read(), Bun.sleep(3000).then(() => ({ done: true, value: undefined }))])
        if (next.done) break
        text += decoder.decode(next.value)
    }
}
await read(1)
await post('shelve', { title: 'guarded' })
await read(2)
await reader.cancel()
const anonymous = await get('locked', { accept: 'text/event-stream' })
frames.push({ op: 'probe', type: admitted.headers.get('content-type'), events: events().map((block) => block.split('\\n')[0]), refused: anonymous.status })
`)
    expect(frames).toEqual([
        {
            op: 'probe',
            type: 'text/event-stream',
            events: ['event: value', 'event: value'],
            refused: 401,
        },
    ])
})

// 18.8 OVER THE MUX — A GUARDED GET'S RUNGS RUN ONCE AS THE SUBSCRIPTION OPENS, in the connection's
// request: an upgrade they admit is fed the value, as an unguarded follower is. THE REVERT: leave every
// guarded follower unadmitted in \`answerFrame\`; the admitted connection is sent triggers alone, and
// no value.
test('a guarded GET feeds a subscription its rungs admitted when it opened — 18.8', async () => {
    const frames = await client(
        `send({ op: 'sub', id: 1, address: '/__abide/rpc/library/locked' })
await until((frames) => frames.some((frame) => frame.op === 'value'))
await post('shelve', { title: 'admitted' })
await until((frames) => frames.filter((frame) => frame.op === 'value').length >= 2)
`,
        { 'x-token': 'ok' },
    )
    const values = frames.filter((frame) => frame.op === 'value') as {
        value: string[]
    }[]
    expect(values.length).toBe(2)
    expect(values[1]?.value.at(-1)).toBe('admitted')
})

// 18.11 — A FOLLOWER SEVERAL PATCHES BEHIND IS SENT THE WRITES SINCE, while the value stays fed: three
// patches one subscription saw land are one patch frame for a second naming the version before them.
// THE REVERT: keep no chain in \`versionOf\` (\`recent\` always empty); the second is sent the value.
test('a follower several patches behind is sent the writes since, not the value — 18.11', async () => {
    const frames = await client(`const answered = await get('books')
const version = Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, ''))
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books', version })
await settled()
for (const title of ['one', 'two', 'three']) await post('rename', { at: 0, title })
await until((frames) => frames.filter((frame) => frame.op === 'patch').length >= 3)
send({ op: 'sub', id: 2, address: '/__abide/rpc/library/books', version })
await until((frames) => frames.some((frame) => frame.id === 2))
await post('rename', { at: 0, title: 'dune' })
`)
    const second = frames.filter((frame) => frame.id === 2)[0] as {
        op: string
        ops?: { value: unknown }[]
    }
    expect(second.op).toBe('patch')
    expect(second.ops?.map((op) => op.value)).toEqual(['one', 'two', 'three'])
})

// 28.2, 36.7 — \`/__abide/logs\` IS A GET OVER \`log.records\`, FOLLOWED: \`abide logs\` prints the lines held,
// then each line a handler writes, read off the \`add\` it is on the standard event stream. THE REVERT:
// take \`LOGS_HANDLER\` out of the handlers abide mounts; the address answers 404 and nothing prints.
test('abide logs follows the GET over log.records, a line per add — 28.2, 36.7', async () => {
    const tail = Bun.spawn(['bun', BIN, 'logs', '--url', base], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    try {
        const reader = (tail.stdout as ReadableStream<Uint8Array>).getReader()
        let seen = ''
        const until = async (text: string): Promise<void> => {
            const deadline = Date.now() + 5_000
            while (!seen.includes(text) && Date.now() < deadline) {
                const { value, done } = await Promise.race([
                    reader.read(),
                    Bun.sleep(5_000).then(() => ({
                        value: undefined,
                        done: true,
                    })),
                ])
                if (done) return
                seen += new TextDecoder().decode(value)
            }
        }
        // Held before the tail opened, so it arrives in the value.
        await spawned([
            'bun',
            BIN,
            'call',
            'library/note',
            'text=before the tail',
            '--url',
            base,
        ])
        await until('before the tail')
        await spawned([
            'bun',
            BIN,
            'call',
            'library/note',
            'text=after the tail',
            '--url',
            base,
        ])
        await until('after the tail')
        expect(seen).toContain('before the tail')
        expect(seen).toContain('after the tail')
    } finally {
        tail.kill()
    }
})

// 18.6 — A FOLLOWER NAMING NO VERSION, or a stale one, is handed what stands.
test('a follower naming no version is handed the value standing', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books' })
await until((frames) => frames.length > 0)
`)
    expect(ops(frames)).toEqual(['value'])
    expect((frames[0] as { value: string[] }).value[0]).toBe('dune')
    expect(typeof (frames[0] as { version: number }).version).toBe('number')
})

// 18.7, 18.11 — A PATCH IS A NEW VERSION although it moves no ordinal (5.7), and a follower standing
// at the version it was written over is sent the writes, not the shelf. THE REVERT: return
// `undefined` from `patchFrom`; the follower is sent the whole shelf as a value, and no patch.
test('a patch reaches a follower as what it wrote, over the version it held', async () => {
    const frames = await client(`const answered = await get('books')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books', version: Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, '')) })
await settled()
await post('rename', { at: 0, title: 'dune messiah' })
await until((frames) => frames.length > 0)
`)
    expect(ops(frames)).toEqual(['patch'])
    const patch = frames[0] as {
        base: number
        version: number
        ops: unknown[]
    }
    expect(patch.ops).toEqual([
        { op: 'replace', path: '/0', value: 'dune messiah' },
    ])
    expect(patch.version).toBeGreaterThan(patch.base)
})

// 18.13 — WHAT CANNOT BE SENT AS WRITES IS SENT AS THE VALUE: a sort by a comparator, which no frame
// can carry. THE REVERT: drop the comparator check in `recordWrites`; the follower is sent a
// `sort` call with no arguments, which on the other side sorts by a different order.
test('a patch that cannot be sent as writes is sent as the value', async () => {
    const frames = await client(`const answered = await get('books')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books', version: Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, '')) })
await settled()
await post('shuffle', {})
await until((frames) => frames.length > 0)
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
await settled()
await post('touch', { id: 2 })
await until((frames) => frames.length > 0)
`)
    expect(frames).toEqual([{ op: 'invalidate', id: 2 }])
})

// 7.18 — the same for a refresh, over a value no production of which is fed.
test('a refresh on the server reaches the followers its pattern names', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 2, address: '/__abide/rpc/library/contact', args: { id: 2 } })
await settled()
await post('touch', { id: 2, refresh: true })
await until((frames) => frames.length > 0)
`)
    expect(frames).toEqual([{ op: 'refresh', id: 2 }])
})

// 13.15 — A SWEEP BY TAG ON THE SERVER REACHES EACH FOLLOWED COPY CARRYING THE TAG, as its own
// trigger, over a plain-function `GET` the server holds no value of between requests — and no copy
// without it. THE REVERT: drop the `RPC_SERVER.swept` call from `refresh` and `invalidate`; the
// browser is sent 0 frames where 2 are due.
test('a sweep by tag on the server reaches the followed copies carrying it — 13.15', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/rpc/library/shows' })
send({ op: 'sub', id: 2, address: '/__abide/rpc/library/contact', args: { id: 9 } })
await settled()
await post('rescan', { refresh: true })
await post('rescan', {})
await until((frames) => frames.length >= 2)
`)
    expect(frames).toEqual([
        { op: 'refresh', id: 1 },
        { op: 'invalidate', id: 1 },
    ])
})

// 13.15 — AND A BARE ONE REACHES EVERY FOLLOWED COPY, tagged or not. THE REVERT: return from
// `swept` where `tags` is `null`; the browser is sent 0 frames where 4 are due.
test('a bare sweep on the server reaches every followed copy — 13.15', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/rpc/library/shows' })
send({ op: 'sub', id: 2, address: '/__abide/rpc/library/contact', args: { id: 9 } })
await settled()
await post('rescan', { refresh: true, bare: true })
await post('rescan', { bare: true })
await until((frames) => frames.length >= 4)
`)
    // Sorted: which handler's followers a sweep reaches first is the order they were first followed in.
    expect(frames.map((frame) => `${frame.op} ${frame.id}`).sort()).toEqual([
        'invalidate 1',
        'invalidate 2',
        'refresh 1',
        'refresh 2',
    ])
})

// 13.15 — A FED COPY IS REFRESHED BY THE PRODUCTION THE SWEEP'S RELOAD MINTS, and sent nothing
// else: a trigger beside it is the browser reading the same value a second time. THE REVERT: send a
// sweep to every follower, fed or not; the browser is sent the refresh as well, 2 frames where 1 is due.
test('a sweep by tag on the server sends a fed copy its reload, and no trigger — 13.15', async () => {
    const frames = await client(`const answered = await get('films')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/films', version: Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, '')) })
await settled()
await post('recatalog', {})
await until((frames) => frames.length > 0)
`)
    expect(ops(frames)).toEqual(['value'])
})

// 7.10 — AN INVALIDATE OF THE VALUE A `GET` SERVES reaches the browsers following it, as
// `rpc.invalidate` does: the trigger is the value's, not the `Rpc`'s. THE REVERT: broadcast from the
// `Rpc`'s members alone; the follower is sent no frame.
test("the value's own invalidate reaches the followers of the GET serving it — 7.10", async () => {
    const frames = await client(`const answered = await get('level')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/level', version: Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, '')) })
await settled()
await post('restock', {})
await until((frames) => frames.length > 0)
`)
    expect(ops(frames)).toEqual(['invalidate'])
})

// 18.8 — A GUARDED HANDLER IS FOLLOWED FOR ITS TRIGGERS AND NEVER FED: its rungs run per request, and
// a value pushed past them is data they never saw. THE REVERT: drop `rpc.guarded` from `follow`; the
// follower is handed the shelf with no token.
test('a guarded handler is followed for its triggers and never fed', async () => {
    const frames = await client(`await get('locked', { 'x-token': 'ok' })
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/locked' })
await settled()
await post('shelve', { title: 'persuasion' })
await post('touchLocked', {})
await until((frames) => frames.some((frame) => frame.op === 'invalidate'))
`)
    expect(ops(frames)).toEqual(['invalidate'])
})

// 18.2 — A FOLLOW FROM ANOTHER ORIGIN IS CLOSED OUT of a `GET` whose `crossOrigin` did not declare it,
// through the handler's own gate (16.24), and the app's own origin is not. THE REVERT: read the
// connection as the app's own whatever its `Origin` (`crossing: null` in `MuxConnection`); the other
// origin is fed the shelf.
test('a follow from another origin is refused a GET that did not declare it — 18.2', async () => {
    const steps = `send({ op: 'sub', id: 1, address: '/__abide/rpc/library/books' })
await until((frames) => frames.length > 0)
`
    const crossing = await client(steps, { origin: 'https://elsewhere.test' })
    expect(crossing).toEqual([
        { op: 'error', id: 1, error: expect.objectContaining({ status: 403 }) },
    ])
    const own = await client(steps, { origin: base })
    expect(ops(own)).toEqual(['value'])
})

// 7.10, 7.18, 13.12 — A `global` `GET` TRIGGERED FROM INSIDE ANOTHER REQUEST, by its args: a request-local
// handler reaches the browsers following the entries its pattern names, and no others — the refreshed
// entry's copy is fed its reload, and the invalidated one is told. THE REVERT: drop the `FOLLOWED` call
// from `invalidateOne`; the second follower is sent nothing.
test('a global GET triggered by args from inside another request reaches the followers its pattern names', async () => {
    const frames = await client(`const one = await get('price?id=1')
const two = await get('price?id=2')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/price', args: { id: 1 }, version: Number(String(one.headers.get('etag')).replace(/[^0-9]/g, '')) })
send({ op: 'sub', id: 2, address: '/__abide/rpc/library/price', args: { id: 2 }, version: Number(String(two.headers.get('etag')).replace(/[^0-9]/g, '')) })
await settled()
await post('reprice', { id: 1, refresh: true })
await until((frames) => frames.some((frame) => frame.id === 1))
await post('reprice', { id: 2 })
await until((frames) => frames.some((frame) => frame.id === 2))
`)
    const seen: unknown[] = []
    for (const frame of frames) seen.push([frame.op, frame.id])
    expect(seen).toEqual([
        ['value', 1],
        ['invalidate', 2],
    ])
}, 15_000)

// 13.12 — NO PATTERN IS EVERY ENTRY, so the same trigger with none reaches every browser following the
// `GET`, whatever args each named. THE REVERT: have `matchesPattern` answer `false` for no pattern;
// neither follower is told.
test('a global GET triggered with no pattern from inside another request reaches every follower', async () => {
    const frames = await client(`const one = await get('price?id=3')
const two = await get('price?id=4')
send({ op: 'sub', id: 1, address: '/__abide/rpc/library/price', args: { id: 3 }, version: Number(String(one.headers.get('etag')).replace(/[^0-9]/g, '')) })
send({ op: 'sub', id: 2, address: '/__abide/rpc/library/price', args: { id: 4 }, version: Number(String(two.headers.get('etag')).replace(/[^0-9]/g, '')) })
await settled()
await post('reprice', {})
await until((frames) => frames.length >= 2)
`)
    const seen: unknown[] = []
    for (const frame of frames) seen.push([frame.op, frame.id])
    expect(seen).toEqual([
        ['invalidate', 1],
        ['invalidate', 2],
    ])
})

// 18.8 — A FOLLOWER SUBSCRIBED BEFORE ITS ENTRY EXISTED is fed from the entry once an answer makes
// it, rather than told of every change and left to fetch it. THE REVERT: decide what a follower is
// fed from once, at `follow`; it is sent the refresh trigger alone (['refresh'] against two values).
test('a follower of args no entry held yet is fed once an answer makes one', async () => {
    const frames =
        await client(`send({ op: 'sub', id: 1, address: '/__abide/rpc/library/price', args: { id: 9 } })
await settled()
await get('price?id=9')
await until((frames) => frames.length >= 1)
await post('reprice', { id: 9, refresh: true })
await until((frames) => frames.length >= 2)
`)
    expect(ops(frames)).toEqual(['value', 'value'])
}, 15_000)
