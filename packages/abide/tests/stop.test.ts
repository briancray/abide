// 37.10-37.12, 42.15 — HOW A SERVED APP ENDS: through `App.stop`, so `onStop` runs, whether the
// process was signalled or faulted. `abide start` spawned, for `serve.test.ts`'s reason, and every
// wait bounded, so a revert fails here rather than hanging the suite.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { GET } from '#server'
import { inOpenScope, scopeFor } from '#server/requestScope.ts'
import { seedFor, takeSeed } from '#server/seedBuffer.ts'
import { addressOf, appFixture, BIN, buildApp } from './builtApp.ts'
import { inMemoryApp } from './inMemoryApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// Writes `stopped` where `MARK` names once `onStop`'s body has run — and never gets there where
// `HANG_ON_STOP` is set, which is how a drain that never finishes is stood in for — held open by a
// timer, as a pending promise alone lets the process run out of work and exit.
const HOOKS = `import { onStop } from 'abide/server'

onStop(async (stop) => {
    if (process.env.HANG_ON_STOP) await new Promise(() => setInterval(() => {}, 1000))
    await stop()
    const mark = process.env.MARK as string
    await Bun.write(mark, (await Bun.file(mark).exists() ? await Bun.file(mark).text() : '') + 'stopped;')
})
`

// KEYED BY ITS ARGS, so the rejection happens when it is called: a handler of none is one value, and
// its body runs where it is declared — at boot.
const HANDLERS = `import { POST } from 'abide/server'

export const fault = POST((args: { reason: string }) => {
    void Promise.reject(new Error(args.reason))
    return 'answered'
})
`

let app = ''

beforeAll(async () => {
    app = appFixture({
        'ui/pages/page.abide': '<main>home</main>',
        'server/app.ts': HOOKS,
        'server/rpc/probe.ts': HANDLERS,
    })
    const built = await buildApp(app)
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr}`)
}, 30_000)

afterAll(removeTemporaryModules)

async function started(
    mark: string,
    env: Record<string, string> = {},
): Promise<{ base: string; served: Bun.Subprocess<'ignore', 'pipe', 'pipe'> }> {
    const served = Bun.spawn(
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
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            env: { ...process.env, MARK: mark, ...env },
        },
    )
    return { base: await addressOf(served), served }
}

// A BOUND ON THE EXIT, so a process that ignores what it was told reads as `still running`. Every
// test then ends it with `SIGKILL`, which no handler can take — a `SIGTERM` is exactly what these
// processes now catch, and a failing run would leave one serving.
function exitWithin(child: Bun.Subprocess, ms: number): Promise<unknown> {
    return Promise.race([
        child.exited,
        Bun.sleep(ms).then(() => 'still running'),
    ])
}

// 37.11 — THE REVERT: drop the signal handlers from `stopOnSignalOrFault`; bun's default ends the
// process on the signal itself, it exits 143 and `onStop` never writes its mark.
test('SIGTERM stops the app through onStop and exits 0 — 37.11', async () => {
    const mark = `${app}/sigterm.txt`
    const { served } = await started(mark)
    served.kill('SIGTERM')
    const code = await exitWithin(served, 10_000)
    served.kill('SIGKILL')
    expect(code).toBe(0)
    expect(await Bun.file(mark).text()).toBe('stopped;')
}, 30_000)

// 37.8, 37.10 — THE REVERT: install `keepServing` in `serveApp` again; the rejection reaches
// `onError` and the process is `still running` when the bound runs out.
test('a rejection nobody awaited reaches onError, then stops the app and exits 1 — 37.8, 37.10', async () => {
    const mark = `${app}/fault.txt`
    const { base, served } = await started(mark)
    const answer = await Bun.fetch(`${base}/__abide/rpc/probe/fault`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"reason":"nobody awaited this"}',
    })
    expect(await answer.json()).toBe('answered')
    const code = await exitWithin(served, 10_000)
    served.kill('SIGKILL')
    expect(code).toBe(1)
    expect(await Bun.file(mark).text()).toBe('stopped;')
    expect(await Bun.readableStreamToText(served.stderr)).toContain(
        'nobody awaited this',
    )
}, 30_000)

// 37.12 — THE REVERT: answer every signal with `stopThenExit(0)`; the second waits on the stop that
// never finishes, and the process is `still running`.
test('a second signal while stopping ends the process at once — 37.12', async () => {
    const mark = `${app}/hang.txt`
    const { served } = await started(mark, { HANG_ON_STOP: '1' })
    served.kill('SIGTERM')
    await Bun.sleep(300)
    served.kill('SIGTERM')
    const code = await exitWithin(served, 5_000)
    served.kill('SIGKILL')
    expect(code).toBe(1)
    expect(await Bun.file(mark).exists()).toBe(false)
}, 30_000)

// 42.15 — THE REVERT: make `stop` call `stopOnce` every time; `onStop` runs twice and the mark
// reads `stopped;stopped;`.
test('App.stop asked twice runs onStop once — 42.15', async () => {
    const mark = `${app}/twice.txt`
    await Bun.write(
        `${app}/twice.ts`,
        `import { createApp } from 'abide/server'
import './server/app.ts'

const app = await createApp()
const first = app.stop()
const second = app.stop()
await Promise.all([first, second])
console.log(first === second)
`,
    )
    const ran = await spawned(['bun', `${app}/twice.ts`], {
        cwd: app,
        env: { ...process.env, MARK: mark },
    })
    expect(ran.stdout.trim()).toBe('true')
    expect(await Bun.file(mark).text()).toBe('stopped;')
}, 30_000)

// 42.11 — A STREAM STILL BEING WRITTEN WHEN THE APP STOPS IS ENDED, in process (`inMemoryApp.ts`): a
// handler that streams forever, read through `App.fetch`, hands its reader the end of the stream once
// `App.stop` has run, rather than streaming into an app that has stopped. THE REVERT: drop both
// `endHeld()` calls from `stopOnce` in `createApp.ts`; the reader is `still streaming` when the bound
// runs out.
test('App.stop ends a stream it is still writing — 42.11', async () => {
    const app = await inMemoryApp({
        'server/rpc/feed.ts': {
            ticks: GET(async function* () {
                let tick = 0
                while (true) {
                    yield tick
                    tick += 1
                    await Bun.sleep(10)
                }
            }),
        },
    })
    const answer = await app.fetch(
        new Request('http://app.internal/__abide/rpc/feed/ticks'),
    )
    const reader = (answer.body as ReadableStream<Uint8Array>).getReader()
    expect((await reader.read()).done).toBe(false)
    await app.stop()
    const ended = (async () => {
        while (!(await reader.read()).done) {}
        return 'ended'
    })()
    expect(
        await Promise.race([
            ended,
            Bun.sleep(1_000).then(() => 'still streaming'),
        ]),
    ).toBe('ended')
})

// 42.11 — A SEED ENTRY IS A TIMER THE APP HOLDS, and the value the render reached: one its render
// left standing is dropped when the app stops, rather than holding both for the rest of its life.
// THE REVERT: drop the `heldByApp` filing from `seedFor` in `seedBuffer.ts`; the app holds 0 entries
// where 1 is due, and the browser's call is still answered from the seed after the stop.
test('App.stop drops the seed entries its renders left — 42.11', async () => {
    const held = new Set<() => void>()
    const app = {
        answer: async () => new Response(),
        mcp: undefined as never,
        held,
    }
    const handler = {}
    const scope = scopeFor(new Request('http://app.internal/'), undefined, app)
    inOpenScope(scope, () => seedFor('caller')(handler, { id: 1 }, 'reached'))
    expect(held.size).toBe(1)
    for (const end of [...held]) end()
    expect(held.size).toBe(0)
    expect(takeSeed('caller', handler, { id: 1 })).toBeUndefined()
})

// 16.42 — A STOPPED APP ANSWERS NO `raw` CALL: one made outside every request after the app built last
// has stopped goes over the wire rather than in process to an app that refuses it. THE REVERT: drop
// the `RPC_SERVER.raw = null` line from `stopOnce` in `createApp.ts`; the stopped app refuses the
// call with its 503 and the wire is reached 0 times, where 1 is due.
test('a raw call outside every request after App.stop does not reach the stopped app — 16.42', async () => {
    let answered = 0
    const greeting = GET(() => {
        answered += 1
        return 'hello'
    })
    const app = await inMemoryApp({ 'server/rpc/stopped.ts': { greeting } })
    expect(await (await greeting.raw()).json()).toBe('hello')
    expect(answered).toBe(1)
    await app.stop()
    const realFetch = globalThis.fetch
    let overTheWire = 0
    globalThis.fetch = (async () => {
        overTheWire += 1
        return Response.json('over the wire')
    }) as unknown as typeof fetch
    try {
        await greeting.raw()
    } finally {
        globalThis.fetch = realFetch
    }
    expect(answered).toBe(1)
    expect(overTheWire).toBe(1)
})
