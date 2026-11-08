// 22.11, 22.12, 38.135 — WHERE A REQUEST CAME FROM, and the interface it could come in on: `requestIP`
// answers the peer under `abide start` (and under `abide dev`, in `dev.test.ts`), `'in-process'` for a
// request no listener received, and `--hostname` binds the one interface it names.

import { afterAll, beforeAll, expect, test } from 'bun:test'

import { GET, requestIP } from '#server'
import { banner } from '#server/banner.ts'

import { serveApp } from './builtApp.ts'
import { inMemoryApp } from './inMemoryApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp(
        {
            'whereFrom.handler.ts': `import { GET, requestIP } from '@abide/abide/server'\n\nexport default GET(() => requestIP(), { description: 'Where the call came from.' })\n`,
        },
        process.env,
        ['--hostname', '127.0.0.1'],
    ))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 38.135 — `--hostname` IS THE ONE INTERFACE: the address printed is the one named, and the IPv6
// loopback a listener on every interface answers is refused. THE REVERT: drop `hostname` from what
// `served` hands `listen`; the address prints as `localhost` and `[::1]` answers.
test('start --hostname listens on the interface it names alone — 38.135', async () => {
    const at = new URL(base)
    expect(at.hostname).toBe('127.0.0.1')
    expect((await Bun.fetch(`${base}/whereFrom`)).status).toBe(200)
    const elsewhere = await Bun.fetch(`http://[::1]:${at.port}/whereFrom`).then(
        () => 'answered',
        () => 'refused',
    )
    expect(elsewhere).toBe('refused')
})

// 38.58, 38.135 — THE BANNER NAMES NO NETWORK ADDRESS for a listener bound to one interface. THE
// REVERT: print the network rows whatever `hostname` is; on a machine with an external interface the
// loopback banner lists it.
test('the banner lists no network address for a named interface — 38.58, 38.135', () => {
    const server = {
        url: new URL('http://127.0.0.1:4000/'),
        port: 4000,
    } as Bun.Server<unknown>
    expect(banner('abide', 'start', {}, server, '127.0.0.1')).not.toContain(
        'Network:',
    )
})

// 22.11 — UNDER `abide start` THE PEER IS BUN'S, and a call the app makes of itself in process is
// `'in-process'`. THE REVERT: drop the `RECEIVED_FROM.set` from `App.listen`'s fetch; the http call
// reads `'in-process'` too.
test('requestIP answers the peer under start, and in-process for a call the app makes of itself — 22.11, 22.12', async () => {
    const direct = (await (
        await Bun.fetch(`${base}/whereFrom`)
    ).json()) as Record<string, unknown>
    expect([direct.address, direct.family, typeof direct.port]).toEqual([
        '127.0.0.1',
        'IPv4',
        'number',
    ])
    const tool = await Bun.fetch(`${base}/__abide/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'get_whereFrom', arguments: {} },
        }),
    })
    const called = ((await tool.json()) as Record<string, unknown>).result as {
        content: { text: string }[]
    }
    expect(JSON.parse(called.content[0]?.text as string)).toBe('in-process')
})

// 22.12 — `App.fetch` WITH NO LISTENER is in process. THE REVERT: answer `null` where nothing filed
// the request in `requestIP`; the call reads `null`, which a unix socket answers too.
test('requestIP answers in-process for App.fetch with no listener — 22.12', async () => {
    const app = await inMemoryApp({
        'whereFrom.handler.ts': { default: GET(() => requestIP()) },
    })
    const answer = await app.fetch(new Request('http://app.test/whereFrom'))
    expect(await answer.json()).toBe('in-process')
    await app.stop()
})
