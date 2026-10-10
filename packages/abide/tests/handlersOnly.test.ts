// 16.2 — AN APP OF HANDLERS ALONE IS AN APP. No page, no `.abide` at all, and every handler still
// answers, in both lanes. THE REVERT: write `rpc.ts` only where there is a page, as `compileApp`
// did; `abide build` then reports "no .abide sources", `abide start` finds no build, and `abide dev`
// mounts an empty table and answers every handler 404.

import { afterAll, expect, test } from 'bun:test'
import { appFixture, buildApp, startApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname
const HANDLER = `import { GET } from '@abide/abide/server'

export const ping = GET(() => 'pong')
`
const ADDRESS = '/__abide/rpc/health/ping'

afterAll(removeTemporaryModules)

test('abide start answers an app of handlers alone — 16.2', async () => {
    const app = appFixture({ 'server/rpc/health.ts': HANDLER })
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
    const app = appFixture({ 'server/rpc/health.ts': HANDLER })
    const dev = Bun.spawn(['bun', BIN, 'dev', '--root', app, '--port', '0'], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    })
    try {
        let seen = ''
        let base = ''
        for await (const chunk of dev.stdout as ReadableStream<Uint8Array>) {
            seen += new TextDecoder().decode(chunk)
            const found = /http:\/\/[^\s]+/.exec(seen)
            if (found) {
                base = new URL(found[0]).origin
                break
            }
        }
        expect(base).not.toBe('')
        const answer = await Bun.fetch(`${base}${ADDRESS}`)
        expect(answer.status).toBe(200)
        expect(await answer.json()).toBe('pong')
    } finally {
        dev.kill()
    }
}, 30_000)
