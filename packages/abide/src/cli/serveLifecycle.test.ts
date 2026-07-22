// serve() drives the onStart(start)/onStop(stop) WRAPPER lifecycle (CL2): setup runs before the
// socket binds, boot is a breakout if start() is never called, and teardown is backstopped.
//
// The lifecycle app.ts is dynamic-imported by loadApp INTO THIS PROCESS, so it shares `globalThis` —
// hooks record their ordering onto `globalThis.__abideLife`, which the test reads back directly. Each
// test writes to a UNIQUE temp dir so its app.ts is a fresh module (import cache is keyed by path).

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadApp } from '../server/internal/loadApp.ts'
import { type ServeResult, serve } from './serve.ts'

const running: ServeResult[] = []
const tempDirs: string[] = []

function tempPath(): string {
    const dir = join(tmpdir(), `abide-life-${Bun.randomUUIDv7()}`)
    tempDirs.push(dir)
    return dir
}

async function project(appTs: string): Promise<string> {
    const dir = tempPath()
    await Bun.write(join(dir, 'src/app.ts'), appTs)
    return dir
}

function events(): string[] {
    return (globalThis as { __abideLife?: string[] }).__abideLife ?? []
}

beforeEach(() => {
    ;(globalThis as { __abideLife?: string[] }).__abideLife = []
})

afterAll(async () => {
    for (const app of running) await app.stop()
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

const WRAP_APP = `
const life = () => ((globalThis).__abideLife ??= [])
export async function onStart(start) {
    life().push('start:before')
    await start()
    life().push('start:after')
}
export async function onStop(stop) {
    life().push('stop:before')
    await stop()
    life().push('stop:after')
}
`

describe('serve — onStart/onStop wrappers', () => {
    test('setup wraps the boot and teardown wraps the stop, in order', async () => {
        const app = await serve(await project(WRAP_APP), { port: 0 })
        // By the time serve() resolves, onStart has wrapped a completed boot.
        expect(events()).toEqual(['start:before', 'start:after'])
        expect((await fetch(`${app.url}/__abide/health`)).status).toBe(200)

        await app.stop()
        expect(events()).toEqual(['start:before', 'start:after', 'stop:before', 'stop:after'])
        // The socket is really closed.
        await expect(fetch(`${app.url}/__abide/health`)).rejects.toThrow()
    })

    test('onStart returning without calling start() is a breakout — serve() throws', async () => {
        const dir = await project(`export function onStart() { /* never boots */ }`)
        await expect(serve(dir, {})).rejects.toThrow(/did not boot/)
    })

    test('onStop that forgets stop() is backstopped — the server is still torn down', async () => {
        const app = await serve(
            await project(`export function onStop() { /* forgets stop() */ }`),
            { port: 0 },
        )
        running.push(app)
        expect((await fetch(`${app.url}/__abide/health`)).status).toBe(200)
        await app.stop()
        await expect(fetch(`${app.url}/__abide/health`)).rejects.toThrow()
    })

    test('onStop that throws before stop() is still backstopped — teardown completes, error re-thrown', async () => {
        const app = await serve(
            await project(`export function onStop() { throw new Error('teardown boom') }`),
            { port: 0 },
        )
        expect((await fetch(`${app.url}/__abide/health`)).status).toBe(200)
        // The hook's throw surfaces to the caller...
        await expect(app.stop()).rejects.toThrow(/teardown boom/)
        // ...but the backstop still tore the server down.
        await expect(fetch(`${app.url}/__abide/health`)).rejects.toThrow()
    })
})

// Regression: onHealth/onError ride on AppConfig, so loadApp must CAPTURE them from src/app.ts (they
// were added to the router before the loader learned to read them — a createApp-direct test can't
// catch that gap). onHealth is verified end-to-end over serve(); onError capture is verified at the
// loadApp layer (a file-based throwing RPC would need `abide/*` imports the tmpdir can't resolve, and
// the router-side firing is already covered by onError.test.ts).
describe('serve — onHealth/onError are loaded from src/app.ts', () => {
    test('a loaded onHealth merges over the framework stub and drives the status code', async () => {
        const app = await serve(
            await project(`
                export function onHealth() { return { app: 'demo', reachable: false } }
            `),
            { port: 0 },
        )
        running.push(app)
        const response = await fetch(`${app.url}/__abide/health`)
        // reachable:false from the loaded hook flips the endpoint to 503.
        expect(response.status).toBe(503)
        const body = await response.json()
        expect(body.app).toBe('demo')
        expect(typeof body.version).toBe('string') // stub floor still present
    })

    test('loadApp captures onHealth AND onError off src/app.ts (both ride AppConfig)', async () => {
        const dir = await project(`
            export function onHealth() { return { app: 'demo' } }
            export function onError() { return new Response('shaped', { status: 503 }) }
        `)
        const loaded = await loadApp(dir)
        expect(typeof loaded.onHealth).toBe('function')
        expect(typeof loaded.onError).toBe('function')
    })
})
