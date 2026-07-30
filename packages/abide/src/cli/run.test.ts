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

// Run `abide run` in a CHILD `bun` process and hand back what it reported.
//
// Needed for exactly one class of script: one that cannot avoid TOP-LEVEL AWAIT. Under
// `bun test --parallel` (Bun 1.3.14) a dynamically imported module's body stops at its first top-level
// await and NEVER RESUMES — not "resolves early", never. Reproducible in six lines with no abide
// involved:
//
//     // mod.ts
//     process.env.A = '1'; await Bun.sleep(10); process.env.B = '1'
//     // a test: await import('./mod.ts') → A is '1', B stays undefined however long you wait
//
// So a script that must `await` a read cannot be observed in-process at all, and no amount of waiting
// helps. Running it through a child `bun` — which is how `abide run` is actually invoked — takes the
// test runner's module loader out of the claim being tested. Everything about the surface stays real:
// `loadApp`, the lifecycle hooks, `bindRpcChains` and the script all run, in one process, as they do
// for a user's migration.
async function runInChild(scriptFile: string): Promise<{ ran?: string; guard?: string }> {
    const runModule = join(import.meta.dir, 'run.ts')
    const driver = join(scratch ?? tmpdir(), 'driver.ts')
    await writeFile(
        driver,
        `import { run } from ${JSON.stringify(runModule)}\n` +
            // Seeded so the assertion reads as a COUNT (see the test) rather than as presence.
            "process.env.__ABIDE_GUARD = '0'\n" +
            `await run(${JSON.stringify(FIXTURE)}, ${JSON.stringify(scriptFile)})\n` +
            'console.log(`__ABIDE_REPORT__${JSON.stringify({ ran: process.env.__ABIDE_RAN, guard: process.env.__ABIDE_GUARD })}`)\n',
    )
    const child = Bun.spawn(['bun', driver], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    const marker = stdout.lastIndexOf('__ABIDE_REPORT__')
    if (code !== 0 || marker === -1) {
        throw new Error(`the child \`abide run\` failed (exit ${code})\n${stdout}\n${stderr}`)
    }
    const json = stdout.slice(marker + '__ABIDE_REPORT__'.length)
    return JSON.parse(
        json.slice(0, json.indexOf('\n') === -1 ? undefined : json.indexOf('\n')),
    ) as {
        ran?: string
        guard?: string
    }
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

    // A MIGRATION'S READS RUN THE RPC'S OWN MIDDLEWARE — the door with no `createApp` behind it.
    //
    // This needs a `run`-shaped harness and cannot be asserted through `createTestApp`, which is exactly
    // how the gap survived: the chain is installed by `createApp`, `createTestApp` calls it, and `run`
    // never does. So the scope-free test next door in `rpcChain.test.ts` passed while the door it named
    // ran no middleware at all.
    //
    // The script imports the rpc by ABSOLUTE path, which is the same specifier `loadApp` used, so ES module
    // caching hands it the very callable the chain was bound to. Importing a second copy would test nothing.
    //
    // A READ IS ASYNCHRONOUS, so this script cannot avoid top-level await the way the port-probe fixture
    // below does — and a script with top-level await is unobservable in-process under the package's own
    // `bun test --parallel`. So it runs in a child `bun`, which is how `abide run` is invoked anyway; see
    // `runInChild` for the six-line repro of why.
    test("a script's read runs the rpc's own middleware", async () => {
        const guarded = join(FIXTURE, 'src/server/rpc/guarded.ts')
        const file = await script(
            `const { default: guarded } = await import(${JSON.stringify(guarded)})\n` +
                'const value = await guarded({})\n' +
                "if (value?.ok !== true) throw new Error('the handler did not run')\n" +
                "process.env.__ABIDE_RAN = '1'\n",
        )
        const report = await runInChild(file)
        expect(report.ran).toBe('1')
        // Once — the read is chained, and chained exactly once. A COUNT, which is why the child seeds the
        // counter to '0' rather than deleting it.
        expect(report.guard).toBe('1')
    })

    test('serves no HTTP — the port a server would have taken stays free', async () => {
        // Ask the OS for a port, release it, and hand it to `abide run` as PORT. Probing a FIXED port
        // (3000) instead made this depend on nothing else on the machine listening there, which is not
        // a property of `abide run` — it failed the moment an unrelated dev server was up.
        const probe = Bun.serve({ port: 0, fetch: () => new Response('taken') })
        const port = probe.port
        probe.stop(true)

        // THE PROBE IS A BIND, NOT A FETCH, AND IT IS SYNCHRONOUS — both halves are load-bearing.
        //
        // Synchronous because of a `bun test --parallel` bug (Bun 1.3.14): under `--parallel`, `await
        // import(specifier)` resolves WITHOUT waiting for the imported module's top-level await to settle.
        // The fixture used to `await fetch(...)` at the top level and assign afterwards, so `run()` returned
        // before the assignment ran and the test read `undefined` — reliably, on every parallel run, which
        // is the package's own `test` script. Reproducible in six lines with no abide involved, and correct
        // under the plain `bun` runtime, so `abide run`'s own `await import` is unaffected. Keeping the
        // fixture free of top-level await sidesteps it entirely rather than pinning a bug's shape.
        //
        // A bind because it is the stronger claim: `Bun.serve` on a taken port throws EADDRINUSE
        // synchronously, so this asserts the port is genuinely UNBOUND. A failed `fetch` only said nothing
        // answered, which a bound-but-broken listener would also satisfy.
        const file = await script(
            'let bound\n' +
                'try {\n' +
                '    const probe = Bun.serve({ port: Number(Bun.env.PORT), fetch: () => new Response("x") })\n' +
                '    probe.stop(true)\n' +
                '    bound = false\n' +
                '} catch {\n' +
                '    bound = true\n' +
                '}\n' +
                "process.env.__ABIDE_RAN = bound ? 'served' : 'unserved'\n",
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
