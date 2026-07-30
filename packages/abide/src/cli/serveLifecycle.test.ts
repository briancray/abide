// The onStart(start)/onStop(stop) WRAPPER lifecycle (CL2), asserted against BOTH surfaces that boot an
// app: `serve()` (abide dev/start/scaffold, a compiled binary's serve, the CLI's ephemeral host) and
// `createTestApp` in discovery mode. CL3 says "same contract under createTestApp" — since both now
// drive `bootApp`, that sentence is a test rather than a promise, and the four contracts (wrap order,
// breakout, backstop, throw-then-backstop) plus the page warm are asserted once per surface.
//
// The lifecycle app.ts is dynamic-imported by loadApp INTO THIS PROCESS, so it shares `globalThis` —
// hooks record their ordering onto `globalThis.__abideLife`, which the test reads back directly. Each
// test writes to a UNIQUE temp dir so its app.ts is a fresh module (import cache is keyed by path).

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadApp } from '../server/internal/loadApp.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { loadEmittedServer } from '../ui/internal/emit.ts'
import { type ServeResult, serve } from './serve.ts'

const running: ServeResult[] = []
const tempDirs: string[] = []

function tempPath(): string {
    const dir = join(tmpdir(), `abide-life-${Bun.randomUUIDv7()}`)
    tempDirs.push(dir)
    return dir
}

async function project(appTs: string, page?: string): Promise<string> {
    const dir = tempPath()
    await Bun.write(join(dir, 'src/app.ts'), appTs)
    if (page !== undefined) await Bun.write(join(dir, 'src/ui/pages/page.abide'), page)
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

// The two surfaces, reduced to the one shape the contracts are about: boot a project dir, get a URL
// and a stop. Anything a surface adds on top (a dev watcher, an rpc proxy) is out of scope here.
interface Booted {
    url: string
    stop(): Promise<void>
}

const SURFACES: [string, (dir: string) => Promise<Booted>][] = [
    ['serve', (dir) => serve(dir, { port: 0 })],
    [
        'createTestApp',
        async (dir) => {
            const app = await createTestApp({ dir })
            return { url: app.origin, stop: (): Promise<void> => app.stop() }
        },
    ],
]

for (const [surface, boot] of SURFACES) {
    describe(`${surface} — onStart/onStop wrappers`, () => {
        test('setup wraps the boot and teardown wraps the stop, in order', async () => {
            const app = await boot(await project(WRAP_APP))
            // By the time boot resolves, onStart has wrapped a completed boot.
            expect(events()).toEqual(['start:before', 'start:after'])
            expect((await fetch(`${app.url}/__abide/health`)).status).toBe(200)

            await app.stop()
            expect(events()).toEqual(['start:before', 'start:after', 'stop:before', 'stop:after'])
            // The socket is really closed.
            await expect(fetch(`${app.url}/__abide/health`)).rejects.toThrow()
        })

        test('onStart returning without calling start() is a breakout — boot throws', async () => {
            const dir = await project(`export function onStart() { /* never boots */ }`)
            await expect(boot(dir)).rejects.toThrow(/did not boot/)
        })

        test('onStop that forgets stop() is backstopped — the server is still torn down', async () => {
            const app = await boot(
                await project(`export function onStop() { /* forgets stop() */ }`),
            )
            expect((await fetch(`${app.url}/__abide/health`)).status).toBe(200)
            await app.stop()
            await expect(fetch(`${app.url}/__abide/health`)).rejects.toThrow()
        })

        test('onStop that throws before stop() is still backstopped — teardown completes, error re-thrown', async () => {
            const app = await boot(
                await project(`export function onStop() { throw new Error('teardown boom') }`),
            )
            expect((await fetch(`${app.url}/__abide/health`)).status).toBe(200)
            // The hook's throw surfaces to the caller...
            await expect(app.stop()).rejects.toThrow(/teardown boom/)
            // ...but the backstop still tore the server down.
            await expect(fetch(`${app.url}/__abide/health`)).rejects.toThrow()
        })

        // The warm is part of the lifecycle, not of serve(): a harness that skipped it would exercise
        // the cold AOT-compile-on-first-render path production never takes. The marker keeps this
        // surface's page source unique, so the module cache starts cold for it either way.
        test('boot warms every page — the first render hits a warm module cache', async () => {
            const source = `<p>warm-${surface}-4b17</p>`
            const dir = await project(WRAP_APP, source)
            const app = await boot(dir)
            running.push(app)

            const loaded = await loadApp(dir, { schemas: 'source' })
            const page = loaded.pages?.['/']
            const pageDir = loaded.pageDirs?.['/']
            expect(page).toBe(source)
            // A warmed source resolves SYNCHRONOUSLY: `Bun.peek` returns the settled module, not the
            // promise. A cold compile would still be pending here.
            const pending = loadEmittedServer(page as string, pageDir)
            expect(Bun.peek(pending)).not.toBe(pending)
        })
    })
}

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
        const loaded = await loadApp(dir, { schemas: 'source' })
        expect(typeof loaded.onHealth).toBe('function')
        expect(typeof loaded.onError).toBe('function')
    })
})
