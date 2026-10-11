// WHAT CROSSES THE WORKER UNDER `abide dev`: the app's mux (18.1, 18.3), which the listener holds
// and the worker answers, and a response body, streamed a chunk per read (38.36, 38.37). Spawned for
// `dev.test.ts`'s reasons, and the client is a spawned bun script for `follow.test.ts`'s: happy-dom's
// `WebSocket` is not bun's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { addressOf, BIN, lastLinePrinted } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const HANDLERS = `import { GET, POST, reactive, request } from '@abide/abide/server'

const shelf = reactive<string[]>(['dune'], { global: true })

export const books = GET(shelf)

export const shelve = POST(({ title }: { title: string }) => {
    shelf.set([...shelf(), title])
})

// Held after its first line until \`release\` is called, so a client that reads the first line before
// releasing it proves the line was sent before the body was done.
let open = (): void => {}
export const held = GET(async function* () {
    yield 'first'
    await new Promise<void>((done) => {
        open = done
    })
    yield 'second'
})

export const release = POST(() => {
    open()
})

// Counts a 64 KB chunk per pull, forever — large, so the socket's own buffer fills in a few — and says how far it got. A \`Response\` of its own (16.36) rather
// than a generator: a streaming \`reactive\` pumps its body to accumulate it (9.1) whoever reads it,
// and what 38.37 is about is the body the connection pulls.
let counted = 0
export const count = GET(
    () =>
        new Response(
            new ReadableStream(
                {
                    pull(controller) {
                        counted += 1
                        controller.enqueue(new Uint8Array(65_536))
                    },
                },
                { highWaterMark: 0 },
            ),
        ),
)

export const howFar = GET(() => counted)

export const patient = GET(() => 1, { timeout: 40_000 })

// A child under the request's signal, named by its pid, and an answer that never ends on its own.
export const spawns = GET(async function* () {
    const child = Bun.spawn(['sleep', '60'], { signal: request().signal })
    yield String(child.pid)
    await new Promise(() => {})
})

// Answers anything, an upgrade included, with the status the lane admits the mux with.
export const nothing = GET(() => new Response(null, { status: 204 }))
`

let server: Bun.Subprocess | undefined
let mountedServer: Bun.Subprocess | undefined
let base = ''
let app = ''

beforeAll(async () => {
    app = temporaryModule({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/library.ts': HANDLERS,
        'package.json': JSON.stringify({
            name: 'dev-follow-fixture',
            type: 'module',
            imports: { '#server/*': './server/*', '#ui/*': './ui/*' },
        }),
    })
    server = Bun.spawn(['bun', BIN, 'dev', '--root', app, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    base = await addressOf(server)
}, 30_000)

afterAll(() => {
    server?.kill()
    mountedServer?.kill()
    removeTemporaryModules()
})

// THE REVERT: send every request to the worker in `serveDev`'s `fetch`; the upgrade is answered as a
// page request, the client never opens, and it prints no frames.
test('a GET is followed over the mux under abide dev', async () => {
    const frames = await followed(base)
    expect(frames.map((frame) => frame.op)).toEqual(['value'])
    expect((frames[0] as { value: string[] }).value).toEqual(['dune', 'emma'])
}, 20_000)

// 16.10 — THE MUX STANDS UNDER THE MOUNT, which only the worker's configuration knows. THE REVERT:
// compare the pathname itself rather than `unmounted`'s in `admitsMux`; the worker says the upgrade
// is not the mux's, the client never opens, and it prints no frames.
test('a GET is followed over the mux under abide dev on a sub-path', async () => {
    mountedServer = Bun.spawn(
        ['bun', BIN, 'dev', '--root', app, '--port', '0'],
        {
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, APP_URL: 'http://localhost/docs' },
        },
    )
    const mountedBase = await addressOf(mountedServer)
    const frames = await followed(mountedBase, '/docs')
    expect(frames.map((frame) => frame.op)).toEqual(['value'])
    expect((frames[0] as { value: string[] }).value).toEqual(['dune', 'emma'])
}, 30_000)

// 37.3 — THE MUX OPENS ONLY AT ITS OWN ADDRESS, whatever status some other address answered an upgrade
// with: the listener cannot read the mount, so the worker says whether an answer `admitsMux`. THE
// REVERT: upgrade in `serveDev`'s `fetch` on `answered.status === 204`; the handler's 204
// opens a mux connection at its address, and this reads ['open', 'open'].
test('an upgrade some other address answers 204 opens nothing under abide dev — 37.3', async () => {
    expect(await upgrades(base)).toEqual(['open', 'refused'])
}, 20_000)

// 37.3 — AN APP WITH NO SOCKET AND NO HANDLER HAS NO MUX, whatever a rung answers its upgrade with,
// under `abide dev` as under `abide start`. THE REVERT: drop the tables from `admitsMux`; the rung's
// 204 at the mux's own address opens a mux over nothing, and this reads ['open'].
test('a rung answering 204 opens no mux where the app carries nothing under abide dev — 37.3', async () => {
    const bare = temporaryModule({
        'ui/pages/page.abide': '<main>home</main>',
        'server/app.ts': `import { middleware } from '@abide/abide/server'

middleware(async (next, { request }) =>
    request.headers.get('upgrade') === 'websocket' ? new Response(null, { status: 204 }) : next(),
)
`,
        'package.json': JSON.stringify({
            name: 'dev-bare-fixture',
            type: 'module',
            imports: { '#server/*': './server/*', '#ui/*': './ui/*' },
        }),
    })
    const bareServer = Bun.spawn(
        ['bun', BIN, 'dev', '--root', bare, '--port', '0'],
        {
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    try {
        expect(
            await upgrades(await addressOf(bareServer), ['/__abide/socket']),
        ).toEqual(['refused'])
    } finally {
        bareServer.kill()
    }
}, 30_000)

// 21.1, 21.3 — THE LISTENER'S OWN ANSWERS carry what every answer does, though no app stamps them.
// THE REVERT: build `serveDev`'s 400 as a bare `Response`; this reads null for both headers.
test('the dev listener refuses a bad upgrade with nosniff and private, no-store — 21.1, 21.3', async () => {
    const dir = temporaryModule({
        'bad.ts': `await fetch(process.argv[2])
const answer = await fetch(process.argv[2] + '/__abide/socket', { headers: { upgrade: 'websocket', connection: 'upgrade' } })
console.log(JSON.stringify([answer.status, answer.headers.get('x-content-type-options'), answer.headers.get('cache-control')]))
`,
    })
    expect(
        await lastLinePrinted<unknown[]>(['bun', `${dir}/bad.ts`, base]),
    ).toEqual([400, 'nosniff', 'private, no-store'])
}, 20_000)

async function followed(
    at: string,
    mount = '',
): Promise<{ op: string; value: string[] }[]> {
    const dir = temporaryModule({
        'client.ts': `const base = process.argv[2] + process.argv[3]
const frames: { op: string }[] = []
const answered = await fetch(base + '/__abide/rpc/library/books')
const version = Number(String(answered.headers.get('etag')).replace(/[^0-9]/g, ''))
const ws = new WebSocket(base.replace('http', 'ws') + '/__abide/socket')
// A subscription to an address nothing answers is refused as the mux reads it, so the refusal
// says the follow sent before it has been taken.
let taken = () => {}
let landed = () => {}
const followed = new Promise<void>((done) => (taken = done))
const shelved = new Promise<void>((done) => (landed = done))
ws.onmessage = (event) => {
    const frame = JSON.parse(String(event.data))
    if (frame.id === 2) return taken()
    frames.push(frame)
    landed()
}
let refused: ReturnType<typeof setTimeout> | undefined
const opened = await Promise.race([
    new Promise((done) => (ws.onopen = () => done(true))),
    new Promise((done) => (refused = setTimeout(() => done(false), 3000))),
])
clearTimeout(refused)
if (opened) {
    ws.send(JSON.stringify({ op: 'sub', id: 1, address: process.argv[3] + '/__abide/rpc/library/books', version }))
    ws.send(JSON.stringify({ op: 'sub', id: 2, address: process.argv[3] + '/__abide/rpc/library/nothingAnswersHere' }))
    await Promise.race([followed, new Promise((done) => setTimeout(done, 3000).unref())])
    await fetch(base + '/__abide/rpc/library/shelve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'emma' }) })
    await Promise.race([shelved, new Promise((done) => setTimeout(done, 3000).unref())])
    // Closed and drained, so a second frame sent before the close lands ahead of what is said.
    ws.close()
    await new Promise((done) => (ws.onclose = done))
}
console.log(JSON.stringify(frames))
`,
    })
    return lastLinePrinted(['bun', `${dir}/client.ts`, at, mount])
}

// Runs \`steps\` in a bun process, where \`base\` is the app and \`say\` is what the test reads back.
async function run(steps: string): Promise<unknown> {
    const dir = temporaryModule({
        'client.ts': `const base = process.argv[2]
const rpc = base + '/__abide/rpc/library/'
let said: unknown
const say = (value: unknown) => { said = value }
${steps}
console.log(JSON.stringify(said))
process.exit(0)
`,
    })
    return lastLinePrinted(['bun', `${dir}/client.ts`, base])
}

// 38.36 — THE FIRST LINE ARRIVES BEFORE THE HANDLER HAS WRITTEN THE LAST, which is only possible
// where it is sent as it is produced: the second line waits on a release the client sends after it
// has read the first. THE REVERT: collect the whole body in \`devWorker\`'s \`answerAsk\` before the
// head goes out; the first read waits on a release that is never sent, and reports 'timed out'.
test('a response body streams through abide dev as the app produces it', async () => {
    const said = await run(`const answer = await fetch(rpc + 'held')
const reader = answer.body!.getReader()
const first = await Promise.race([
    reader.read().then(({ value }) => new TextDecoder().decode(value)),
    new Promise((done) => setTimeout(() => done('timed out'), 3000)),
])
await fetch(rpc + 'release', { method: 'POST' })
say(first)
`)
    expect(String(said)).toContain('first')
    expect(String(said)).not.toContain('second')
}, 20_000)

// 38.37 — A READER THAT STOPS STOPS THE HANDLER: an endless body, read once, is pulled only as far as
// the socket's buffers take it — 21 to 31 chunks of 64 KB over three runs on macOS, 71 on a
// linux CI runner, whose buffers autotune larger, and 256 is the bound. THE REVERT: have \`pull\` in \`devWorker\` loop the reader to the end rather than read one chunk; the
// worker reads the endless body flat out, and the client's second request is never answered.
test('abide dev reads no more of a body than the connection has taken', async () => {
    const said = await run(`const answer = await fetch(rpc + 'count')
const reader = answer.body!.getReader()
await reader.read()
await new Promise((done) => setTimeout(done, 200))
say(await (await fetch(rpc + 'howFar')).json())
reader.cancel()
`)
    expect(Number(said)).toBeLessThan(256)
}, 20_000)

// 38.97 — A HANDLER'S CHILD GOES WITH ITS REQUEST: the listener holds the connection, so a hang-up
// reaches the worker as a message, and the request the app reads has to abort on it as bun's would.
// The answer never ends, so only the signal can stop the child; `gone` looks for it for 3 s, and
// kills it itself where it is still there.
const SPAWNED = `const answer = await fetch(rpc + 'spawns')
const reader = answer.body!.getReader()
const pid = Number(/\\d+/.exec(new TextDecoder().decode((await reader.read()).value))?.[0])
const alive = () => { try { process.kill(pid, 0); return true } catch { return false } }
const gone = async () => {
    for (const deadline = Date.now() + 3000; Date.now() < deadline; await Bun.sleep(50))
        if (!alive()) return true
    process.kill(pid)
    return false
}
`

// THE REVERT: drop `signal` from the `Request` `answerAsk` builds in `devWorker`. Run:
// `child gone: false`.
test('a caller hanging up aborts the request under abide dev — 38.97', async () => {
    const said = await run(`${SPAWNED}
await reader.cancel()
say(\`child gone: \${await gone()}\`)
`)
    expect(said).toBe('child gone: true')
}, 20_000)

// THE REVERT: drop `process.on('SIGTERM', hangUpAndExit)` in `devWorker`. Run: `child gone: false` —
// the worker replaced on a reload, and the child it spawned left running.
test('a reload aborts the requests the replaced worker was answering — 38.97', async () => {
    const said = await run(`${SPAWNED}
const library = ${JSON.stringify(`${app}/server/rpc/library.ts`)}
await Bun.write(library, await Bun.file(library).text())
say(\`child gone: \${await gone()}\`)
reader.cancel().catch(() => {})
`)
    expect(said).toBe('child gone: true')
}, 20_000)

// 16.22 UNDER `abide dev` — THE CONNECTION IS THE LISTENER'S, and the worker answering the call has no
// server to raise its idle timeout on: it asks the listener to, naming the request by its ask. The
// listener's own `timeout` is recorded rather than waited out, because bun closes a pending request
// only at about twice its 10 s idle timeout. THE REVERT: leave `LISTENING.timeout` unset in
// `devWorker`; nothing is raised, and this reads `[]`.
test('a call that declares a timeout raises the idle timeout under abide dev', async () => {
    const dir = temporaryModule({
        'raise.ts': `import { serveDev } from '${new URL('../src/server/serveDev.ts', import.meta.url).pathname}'
const raised: number[] = []
const serve = Bun.serve
Bun.serve = ((options: never) => {
    const bound = serve(options)
    const timeout = bound.timeout.bind(bound)
    bound.timeout = (request: Request, seconds: number) => {
        raised.push(seconds)
        timeout(request, seconds)
    }
    return bound
}) as typeof Bun.serve
const server = await serveDev({ root: process.argv[2] as string, port: 0 })
const answered = await fetch(new URL('/__abide/rpc/library/patient', server.url))
console.log(JSON.stringify({ status: answered.status, raised }))
process.exit(0)
`,
    })
    expect(
        await lastLinePrinted<Record<string, unknown>>([
            'bun',
            `${dir}/raise.ts`,
            app,
        ]),
    ).toEqual({
        status: 200,
        raised: [40],
    })
}, 30_000)

// Opens a web socket at each address in turn, and says which opened.
async function upgrades(
    at: string,
    addresses = ['/__abide/socket', '/__abide/rpc/library/nothing'],
): Promise<string[]> {
    const dir = temporaryModule({
        'upgrade.ts': `// A page first: the listener holds it until the worker is ready, where an upgrade would be refused
// as still rebuilding and read the same as one the mux turned away.
await fetch(process.argv[2])
const base = process.argv[2].replace('http', 'ws')
const opened = async (address: string) => {
    const ws = new WebSocket(base + address)
    const outcome = await new Promise<string>((done) => {
        ws.onopen = () => done('open')
        ws.onerror = () => done('refused')
    })
    ws.close()
    return outcome
}
const outcomes = []
for (const address of JSON.parse(process.argv[3])) outcomes.push(await opened(address))
console.log(JSON.stringify(outcomes))
`,
    })
    return lastLinePrinted([
        'bun',
        `${dir}/upgrade.ts`,
        at,
        JSON.stringify(addresses),
    ])
}
