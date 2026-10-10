// 18.1, 37.3 — THE UPGRADE TO THE MUX, over a served app: the app lane runs over it as over any request,
// it opens only at its own address, and each connection it opens is a line on `abide:socket`. The
// clients are spawned bun scripts, for `follow.test.ts`'s reason: happy-dom's preload is in this
// process, and its `WebSocket` is not bun's.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { BIN, lastLinePrinted, serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

// A `GET` over a `global` value, so the app has a handler for the mux to carry (37.3).
const HANDLERS = `import { GET, reactive } from '@abide/abide/server'

export const books = GET(reactive<string[]>(['dune'], { global: true }))

// Answers anything, an upgrade included, with the status the lane admits the mux with.
export const nothing = GET(() => new Response(null, { status: 204 }))
`

// 37.3 — an app rung that refuses a request it can tell by a header, the mux's upgrade included.
const APP = `import { middleware } from '@abide/abide/server'

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
        'server/rpc/library.ts': HANDLERS,
        'server/app.ts': APP,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// Opens a web socket at each `[address, headers]` in turn, printing whether each opened or was refused.
async function opened(
    attempts: [string, Record<string, string>][],
): Promise<string[]> {
    const dir = temporaryModule({
        'upgrade.ts': `const base = process.argv[2].replace('http', 'ws')
const attempts = JSON.parse(process.argv[3]) as [string, Record<string, string>][]
const outcomes: string[] = []
for (const [address, headers] of attempts) {
    const ws = new WebSocket(base + address, { headers })
    outcomes.push(
        await new Promise<string>((done) => {
            ws.onopen = () => done('open')
            ws.onerror = () => done('refused')
        }),
    )
    ws.close()
}
console.log(JSON.stringify(outcomes))
`,
    })
    return lastLinePrinted<string[]>([
        'bun',
        `${dir}/upgrade.ts`,
        base,
        JSON.stringify(attempts),
    ])
}

// 37.3 — THE APP LANE RUNS OVER THE MUX'S UPGRADE as over any request, so a connection its rung
// refused is never opened — and with it every `GET` the mux would have followed past that rung.
// THE REVERT: upgrade in `listen`'s `fetch` whatever the app lane answered (hand `admitsMux` a 204
// of its own); the refused connection opens, and this reads ['open', 'open'].
test('an app rung that refuses the upgrade keeps the mux closed — 37.3', async () => {
    expect(
        await opened([
            ['/__abide/socket', {}],
            ['/__abide/socket', { 'x-denied': '1' }],
        ]),
    ).toEqual(['open', 'refused'])
})

// 37.3 — THE MUX OPENS ONLY AT ITS OWN ADDRESS, whatever status some other address answered an upgrade
// with. THE REVERT: drop the address from `admitsMux`; the handler's 204 opens a mux connection at its
// address, and this reads ['open', 'open'].
test('an upgrade some other address answers 204 opens nothing — 37.3', async () => {
    expect(
        await opened([
            ['/__abide/socket', {}],
            ['/__abide/rpc/library/nothing', {}],
        ]),
    ).toEqual(['open', 'refused'])
})

// 18.1 — A MUX CONNECTION OPENED IS A LINE ON `abide:socket`, under `abide start` as under the mux alone.
// THE REVERT: override the listener's `open` without calling the mux's; 0 lines where there was 1.
test('abide start logs each mux connection on abide:socket — 18.1', async () => {
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
        const opening = Bun.spawn(
            [
                'bun',
                '-e',
                `const ws = new WebSocket(${JSON.stringify(`ws://${url.host}/__abide/socket`)}); ws.onopen = () => { ws.close(); process.exit(0) }`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
        )
        await opening.exited
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
