// 16.2 — AN APP OF HANDLERS ALONE IS AN APP. No page, no `.abide` at all — one handler file — and
// it still answers, in both lanes. THE REVERT: return early from `compileApp` where there is no
// `.abide`; the handler file is never mounted, and both lanes answer it 404.

import { afterAll, expect, spyOn, test } from 'bun:test'
import { compileApp } from '#compiler/compileApp.ts'
import { TypeSession } from '#compiler/TypeSession.ts'
import { addressOf, appFixture, BIN, buildApp, startApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const HANDLER = `import { GET } from '@abide/abide/server'

export default GET(() => 'pong')
`
const ADDRESS = '/health/ping'

afterAll(removeTemporaryModules)

test('abide start answers an app of handlers alone — 16.2', async () => {
    const app = appFixture({ 'health/ping.ts': HANDLER })
    const built = await buildApp(app)
    expect(built.stderr).toBe('')
    expect(built.exitCode).toBe(0)
    const { base, stop } = await startApp(app)
    try {
        const answer = await Bun.fetch(`${base}${ADDRESS}`)
        expect(answer.status).toBe(200)
        expect(await answer.json()).toBe('pong')
    } finally {
        stop()
    }
}, 30_000)

test('abide dev answers an app of handlers alone — 16.2', async () => {
    const app = appFixture({ 'health/ping.ts': HANDLER })
    const dev = Bun.spawn(['bun', BIN, 'dev', '--root', app, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    })
    try {
        const base = await addressOf(dev)
        const answer = await Bun.fetch(`${base}${ADDRESS}`)
        expect(answer.status).toBe(200)
        expect(await answer.json()).toBe('pong')
    } finally {
        dev.kill()
    }
}, 30_000)

// 16.73 — WHAT AN APP'S OWN HANDLER FILE EXPORTS IS ASKED OF THE SNAPSHOT ITS READS TOOK: its file is
// a root of the project already, so asking it moves nothing. Asserted on the WORK, the snapshots
// taken, because the answer is the same either way. THE REVERT: drop the `dependency` guard in
// `TypeSession.projectWith`; every own handler file is told to the config as moved, and the
// project is reloaded: 2 snapshots where 1 is due.
test('an own handler file is asked of the snapshot already taken — 16.73', async () => {
    const app = appFixture({
        'index.abide': '<p>home</p>',
        'health/ping.ts': HANDLER,
    })
    const snapshot = spyOn(
        TypeSession.prototype as unknown as { snapshot: () => unknown },
        'snapshot',
    )
    try {
        await compileApp(app)
        expect(snapshot).toHaveBeenCalledOnce()
    } finally {
        snapshot.mockRestore()
    }
}, 30_000)
