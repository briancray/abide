// 37.10-37.12, 42.15 — HOW A SERVED APP ENDS: through `App.stop`, so `onStop` runs, whether the
// process was signalled or faulted. `abide start` spawned, for `serve.test.ts`'s reason, and every
// wait bounded, so a revert fails here rather than hanging the suite.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawned } from 'harness/gate'
import { addressOf, appFixture, BIN, buildApp } from './builtApp.ts'
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
