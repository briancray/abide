// `abide run <file> [args…]` — CL2. A script under the abide runtime, serving no HTTP.
//
// The claims worth pinning are the ones that distinguish it from `bun <file>`: the app is LOADED
// (config/env validated, rpc modules imported, `src/app.ts` hooks run) and nothing is SERVED. The
// lifecycle half is the same contract `bootApp` gets — `appLifecycle` owns it for both — so the
// breakout and backstop cases are asserted here against the surface that binds nothing, which is
// where a lifecycle written into the HTTP boot would have shown its seams.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './run.ts'

const FIXTURE = join(import.meta.dir, '../server/__fixtures__/lifecycleApp')

// The fixture's hooks record into process.env; each test starts from a clean slate.
beforeEach(() => {
    delete process.env.__ABIDE_LC_START
    delete process.env.__ABIDE_LC_STOP
    delete process.env.__ABIDE_RAN
    delete process.env.__ABIDE_RAN_ARGV
})

let scratch: string | undefined
afterEach(async () => {
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true })
    scratch = undefined
})

// Scripts are written to a fresh temp dir and imported by absolute path, so each test's module is a
// distinct specifier — an ES module is cached per URL and would otherwise run only once.
async function script(body: string): Promise<string> {
    scratch = await mkdtemp(join(tmpdir(), 'abide-run-'))
    const file = join(scratch, 'task.ts')
    await writeFile(file, body)
    return file
}

describe('abide run', () => {
    test('runs the script with the app loaded and its lifecycle hooks wrapped around it', async () => {
        const file = await script(`
            process.env.__ABIDE_RAN = '1'
            // The hook must have run BEFORE the script — onStart wraps the boot, and the script is
            // the workload that boot makes possible.
            if (process.env.__ABIDE_LC_START !== '1') throw new Error('onStart did not run first')
            if (process.env.__ABIDE_LC_STOP === '1') throw new Error('onStop ran too early')
        `)
        await run(FIXTURE, file)
        expect(process.env.__ABIDE_RAN).toBe('1')
        expect(process.env.__ABIDE_LC_START).toBe('1')
        expect(process.env.__ABIDE_LC_STOP).toBe('1')
    })

    test('serves no HTTP — the port a server would have taken stays free', async () => {
        // Ask the OS for a port, release it, and hand it to `abide run` as PORT. Probing a FIXED port
        // (3000) instead made this depend on nothing else on the machine listening there, which is not
        // a property of `abide run` — it failed the moment an unrelated dev server was up.
        const probe = Bun.serve({ port: 0, fetch: () => new Response('taken') })
        const port = probe.port
        probe.stop(true)

        const file = await script(
            // The `${}` belongs to the SCRIPT being written to disk, not to this file — making this a
            // template literal would substitute at test-build time and the fixture would read the wrong port.
            // biome-ignore lint/suspicious/noTemplateCurlyInString: see above — it is the fixture's syntax.
            'const reachable = await fetch(`http://127.0.0.1:${Bun.env.PORT}/__abide/health`)\n' +
                '    .then(() => true)\n' +
                '    .catch(() => false)\n' +
                "process.env.__ABIDE_RAN = reachable ? 'served' : 'unserved'\n",
        )
        const previousPort = Bun.env.PORT
        Bun.env.PORT = String(port)
        try {
            await run(FIXTURE, file)
        } finally {
            if (previousPort === undefined) delete Bun.env.PORT
            else Bun.env.PORT = previousPort
        }
        expect(process.env.__ABIDE_RAN).toBe('unserved')
    })

    test('the script sees `bun <file> [args…]` argv, and argv is restored afterwards', async () => {
        const file = await script(`
            process.env.__ABIDE_RAN_ARGV = JSON.stringify(process.argv.slice(2))
        `)
        const before = process.argv
        await run(FIXTURE, file, ['--port', '5', 'extra'])
        // Everything after the file belongs to the SCRIPT, including things that look like abide flags.
        expect(JSON.parse(process.env.__ABIDE_RAN_ARGV ?? '[]')).toEqual(['--port', '5', 'extra'])
        expect(process.argv).toBe(before)
    })

    test('a throwing script propagates, and onStop still runs (the backstop)', async () => {
        const file = await script(`throw new Error('migration failed')`)
        await expect(run(FIXTURE, file)).rejects.toThrow('migration failed')
        expect(process.env.__ABIDE_LC_STOP).toBe('1')
    })
})
