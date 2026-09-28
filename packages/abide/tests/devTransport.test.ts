// WHAT CROSSES THE WORKER UNDER `abide dev`: the app's mux (18.2, 18.17), which the listener holds
// and the worker answers, and a response body, streamed a chunk per read (38.36, 38.37). Spawned for
// `dev.test.ts`'s reasons, and the client is a spawned bun script for `socket.test.ts`'s: happy-dom's
// `WebSocket` is not bun's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { addressOf, BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const HANDLERS = `import { GET, POST, reactive } from 'abide/server'

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

// Counts a 64 KB chunk per pull, forever — large, so the socket's own buffer fills in a few — and says how far it got. A \`Response\` of its own (16.37) rather
// than a generator: a streaming \`reactive\` pumps its body to accumulate it (9.2) whoever reads it,
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

// 16.11 — THE MUX STANDS UNDER THE MOUNT, which only the worker's configuration knows. THE REVERT:
// take only `SOCKET_ADDRESS` itself for the mux in `serveDev`'s `fetch`; the worker answers the
// upgrade 204, the client never opens, and it prints no frames.
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

async function followed(
    at: string,
    mount = '',
): Promise<{ op: string; value: string[] }[]> {
    const dir = temporaryModule({
        'client.ts': `const base = process.argv[2] + process.argv[3]
const frames: unknown[] = []
const answered = await fetch(base + '/__abide/rpc/library/books')
const version = Number(answered.headers.get('abide-version'))
const ws = new WebSocket(base.replace('http', 'ws') + '/__abide/socket')
ws.onmessage = (event) => frames.push(JSON.parse(String(event.data)))
const opened = await Promise.race([
    new Promise((done) => (ws.onopen = () => done(true))),
    new Promise((done) => setTimeout(() => done(false), 3000)),
])
if (opened) {
    ws.send(JSON.stringify({ op: 'sub', id: 1, address: process.argv[3] + '/__abide/rpc/library/books', version }))
    await new Promise((done) => setTimeout(done, 100))
    await fetch(base + '/__abide/rpc/library/shelve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'emma' }) })
    await new Promise((done) => setTimeout(done, 200))
    ws.close()
}
console.log(JSON.stringify(frames))
`,
    })
    const ran = Bun.spawn(['bun', `${dir}/client.ts`, at, mount], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const printed = await new Response(ran.stdout).text()
    return JSON.parse(printed.trim().split('\n').at(-1) as string)
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
`,
    })
    const ran = Bun.spawn(['bun', `${dir}/client.ts`, base], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const printed = await new Response(ran.stdout).text()
    return JSON.parse(printed.trim().split('\n').at(-1) as string)
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
// the socket's buffers take it — 21 to 31 chunks of 64 KB over three runs, and 64 is the bound. THE
// REVERT: have \`pull\` in \`devWorker\` loop the reader to the end rather than read one chunk; the
// worker reads the endless body flat out, and the client's second request is never answered.
test('abide dev reads no more of a body than the connection has taken', async () => {
    const said = await run(`const answer = await fetch(rpc + 'count')
const reader = answer.body!.getReader()
await reader.read()
await new Promise((done) => setTimeout(done, 200))
say(await (await fetch(rpc + 'howFar')).json())
reader.cancel()
`)
    expect(Number(said)).toBeLessThan(64)
}, 20_000)

// 16.23 UNDER `abide dev` — THE CONNECTION IS THE LISTENER'S, and the worker answering the call has no
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
    const ran = Bun.spawn(['bun', `${dir}/raise.ts`, app], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const printed = await new Response(ran.stdout).text()
    expect(JSON.parse(printed.trim().split('\n').at(-1) as string)).toEqual({
        status: 200,
        raised: [40],
    })
}, 30_000)
