// The COMMAND face of a compiled binary (MS3) — the same executable `compile.test.ts` hosts as a
// server. One compile, then every claim the projection makes is checked against the real thing, run
// from a directory that holds nothing but the binary:
//
//   - `clients.cli` rpcs are subcommands, and a `cli: false` one is not;
//   - the schema is the parser (`--a 2 --b 3` sums to 5 — a string-typed flag would concatenate);
//   - a mutation POSTs its args and passes the CSRF gate;
//   - a streaming handler line-streams to stdout;
//   - failures are structured stderr + a failure-class exit code;
//   - no subcommand = the interactive REPL, which fills a bare command in from its schema;
//   - `serve` from the prompt promotes the app onto a real port and commands keep working, and it
//     does so even when the app exports an rpc BY THAT NAME (the reserved built-in wins);
//   - a bare invocation with NO console and NO stdin fails loudly instead of exiting 0 in silence;
//   - `--url` targets a deployment INSTEAD of hosting the embedded app;
//   - `connect` remembers WHERE across runs and `login` remembers WHO (keyed by origin, `0600`,
//     per-user), the flag/env rungs still outrank both, `identity` asks the server who you are, and
//     `disconnect`/`logout` drop the two independently.

import { afterAll, describe, expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import { mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from './compile.ts'

const ABIDE_PACKAGE_DIR = join(import.meta.dir, '../..')

const tempDirs: string[] = []

function tempPath(prefix: string): string {
    const dir = join(tmpdir(), `abide-${prefix}-${Bun.randomUUIDv7()}`)
    tempDirs.push(dir)
    return dir
}

afterAll(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

async function fixtureProject(): Promise<string> {
    const dir = tempPath('cli-app')
    await Bun.write(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'demoapp', type: 'module', dependencies: { abide: '*' } }),
    )
    await Bun.write(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                paths: { '$server/*': ['./src/server/*'], '$ui/*': ['./src/ui/*'] },
            },
        }),
    )
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await symlink(ABIDE_PACKAGE_DIR, join(dir, 'node_modules/abide'))

    await Bun.write(
        join(dir, 'src/server/rpc/greet.ts'),
        `import { GET } from 'abide/server/GET'\n` +
            `export default GET(({ name = 'world' }) => \`Hello, \${name}!\`)\n`,
    )
    await Bun.write(
        join(dir, 'src/server/rpc/add.ts'),
        `import { GET } from 'abide/server/GET'\n` +
            `export default GET(({ a = 0, b = 0 }) => ({ sum: a + b }))\n`,
    )
    await Bun.write(
        join(dir, 'src/server/rpc/save.ts'),
        `import { POST } from 'abide/server/POST'\n` +
            `export default POST(({ value = '' }) => ({ saved: value }))\n`,
    )
    await Bun.write(
        join(dir, 'src/server/rpc/countdown.ts'),
        `import { GET } from 'abide/server/GET'\n` +
            `import { jsonl } from 'abide/server/jsonl'\n` +
            `export default GET(() =>\n` +
            `    jsonl(\n` +
            `        (async function* () {\n` +
            `            yield { n: 3 }\n` +
            `            yield { n: 2 }\n` +
            `            yield { n: 1 }\n` +
            `        })(),\n` +
            `    ),\n` +
            `)\n`,
    )
    await Bun.write(
        join(dir, 'src/server/rpc/boom.ts'),
        `import { error } from 'abide/server/error'\n` +
            `import { GET } from 'abide/server/GET'\n` +
            `export default GET(() => error(503, 'nope'))\n`,
    )
    await Bun.write(
        join(dir, 'src/server/rpc/hidden.ts'),
        `import { GET } from 'abide/server/GET'\n` +
            `export default GET(() => 'secret', { clients: { cli: false } })\n`,
    )
    // Collides with the reserved `serve` subcommand on purpose: hosting has no second door, so the
    // built-in has to win, and this rpc must not answer `serve`.
    await Bun.write(
        join(dir, 'src/server/rpc/serve.ts'),
        `import { GET } from 'abide/server/GET'\n` +
            `export default GET(() => 'THE RPC, NOT THE SERVER')\n`,
    )
    await Bun.write(join(dir, 'src/ui/pages/page.abide'), `<h1>ok</h1>\n`)
    return dir
}

interface RunResult {
    code: number
    stdout: string
    stderr: string
}

// Run the executable from a directory holding NOTHING but the executable, so anything it still reads
// off the filesystem fails loudly instead of quietly finding the project it was built from.
async function run(
    executable: string,
    argv: string[],
    options: { stdin?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
    const emptyCwd = tempPath('cli-run')
    await mkdir(emptyCwd, { recursive: true })
    const proc = Bun.spawn([executable, ...argv], {
        cwd: emptyCwd,
        stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, ...options.env },
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

describe('a compiled binary — the app as a command-line tool', () => {
    test('dispatches rpcs as subcommands, self-hosting, with no project on disk', async () => {
        const dir = await fixtureProject()
        const runDir = tempPath('cli-out')
        await mkdir(runDir, { recursive: true })
        const executable = join(runDir, 'demoapp')

        expect(await compile(dir, { out: executable })).toEqual([executable])
        expect(await Bun.file(executable).exists()).toBe(true)

        // The source the binary was built from is GONE for every one-shot run below.
        await rm(dir, { recursive: true, force: true })

        const help = await run(executable, ['--help'])
        expect(help.code).toBe(0)
        expect(help.stdout).toContain('greet')
        expect(help.stdout).toContain('countdown')
        expect(help.stdout).toContain('interactive mode')
        // `clients: { cli: false }` is reachability: the subcommand is not generated.
        expect(help.stdout).not.toContain('hidden')

        const greet = await run(executable, ['greet', '--name', 'abide'])
        expect(greet.code).toBe(0)
        expect(greet.stdout.trim()).toBe('"Hello, abide!"')

        // The schema is the parser: typed as integers these SUM. Passed as strings they would
        // concatenate to "23", which is exactly the bug an untyped flag parser ships.
        const add = await run(executable, ['add', '--a', '2', '--b', '3'])
        expect(add.code).toBe(0)
        expect(JSON.parse(add.stdout)).toEqual({ sum: 5 })

        // A mutation posts its args and satisfies the CSRF gate.
        const save = await run(executable, ['save', '--value', 'written'])
        expect(save.code).toBe(0)
        expect(JSON.parse(save.stdout)).toEqual({ saved: 'written' })

        // `--args` is the whole-object escape hatch.
        const viaArgs = await run(executable, ['greet', '--args', '{"name":"json"}'])
        expect(viaArgs.stdout.trim()).toBe('"Hello, json!"')

        // A streaming handler reaches stdout as one JSON value per line.
        const stream = await run(executable, ['countdown'])
        expect(stream.code).toBe(0)
        expect(
            stream.stdout
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line)),
        ).toEqual([{ n: 3 }, { n: 2 }, { n: 1 }])

        // A failure is a parseable stderr object plus a failure-CLASS exit code (5xx → 7).
        const boom = await run(executable, ['boom'])
        expect(boom.code).toBe(7)
        expect(boom.stdout).toBe('')
        expect(JSON.parse(boom.stderr)).toMatchObject({ status: 503, message: 'nope' })

        // A bad command line never sends anything — a usage exit, distinct from any server answer.
        const unknown = await run(executable, ['nope'])
        expect(unknown.code).toBe(2)
        expect(unknown.stderr).toContain('unknown command "nope"')

        const badFlag = await run(executable, ['add', '--a', 'lots'])
        expect(badFlag.code).toBe(2)
        expect(badFlag.stderr).toContain('--a expects')
    }, 180_000)

    test('--platforms cross-compiles one binary per target, named for it', async () => {
        const dir = await fixtureProject()
        const outDir = tempPath('cli-platforms')
        await mkdir(outDir, { recursive: true })
        // The HOST triple, so the test exercises the fan-out without downloading a foreign Bun runtime.
        const host = `bun-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`

        const built = await compile(dir, { platforms: [host], out: outDir })

        expect(built).toEqual([join(outDir, `demoapp-${host}`)])
        expect(await Bun.file(join(outDir, `demoapp-${host}`)).exists()).toBe(true)
    }, 180_000)

    test('no subcommand = an interactive REPL that fills a command in from its schema', async () => {
        const dir = await fixtureProject()
        const runDir = tempPath('cli-repl-out')
        await mkdir(runDir, { recursive: true })
        const executable = join(runDir, 'demoapp')
        await compile(dir, { out: executable })
        await rm(dir, { recursive: true, force: true })

        // Line 1 carries flags; line 2 is a BARE command, so the REPL prompts for `name` from the
        // schema and line 3 answers it.
        const session = await run(executable, [], {
            stdin: 'greet --name repl\ngreet\nprompted\nexit\n',
        })
        expect(session.code).toBe(0)
        expect(session.stdout).toContain('demoapp — interactive')
        expect(session.stdout).toContain('"Hello, repl!"')
        expect(session.stdout).toContain('name (string, optional)')
        expect(session.stdout).toContain('"Hello, prompted!"')
    }, 180_000)

    test('`serve` from the prompt promotes the app onto a real port, and commands keep working', async () => {
        const dir = await fixtureProject()
        const runDir = tempPath('cli-host-out')
        await mkdir(runDir, { recursive: true })
        const executable = join(runDir, 'demoapp')
        await compile(dir, { out: executable })
        await rm(dir, { recursive: true, force: true })

        // A port nothing holds right now. The bind races anything else grabbing it in between, which is
        // acceptable here for the same reason it is in `abide dev`'s port hop.
        const probe = Bun.serve({ port: 0, fetch: () => new Response() })
        const port = probe.port
        probe.stop(true)

        const session = await run(executable, [], {
            stdin: `serve --port ${port}\ngreet --name hosted\nexit\n`,
        })
        expect(session.code).toBe(0)
        // It reports the real URL — not the ephemeral port a one-shot command would have used …
        expect(session.stdout).toContain(`serving http://localhost:${port}`)
        // … the reserved built-in won over the app's own `serve` rpc …
        expect(session.stdout).not.toContain('THE RPC, NOT THE SERVER')
        // … and the rebind left the app callable, so the session goes on against it.
        expect(session.stdout).toContain('"Hello, hosted!"')
    }, 180_000)

    test('`connect`/`login` remember WHERE and WHO separately, across runs', async () => {
        const dir = await fixtureProject()
        const runDir = tempPath('cli-connect-out')
        await mkdir(runDir, { recursive: true })
        const executable = join(runDir, 'demoapp')
        await compile(dir, { out: executable })
        await rm(dir, { recursive: true, force: true })

        // The stored target lives in the per-USER data dir, so the test has to own one — otherwise it
        // would write into the developer's real ~/Library/Application Support/abide.
        const dataDir = tempPath('cli-connect-data')
        await mkdir(dataDir, { recursive: true })
        const env = { ABIDE_DATA_DIR: dataDir }

        const authorizations: (string | null)[] = []
        const stub = (body: string) =>
            Bun.serve({
                port: 0,
                fetch(request) {
                    authorizations.push(request.headers.get('authorization'))
                    // `identity` asks the framework route; everything else is the rpc face.
                    if (new URL(request.url).pathname === '/__abide/identity') {
                        return Response.json({ id: 'stub-user', authenticated: true })
                    }
                    return Response.json(body)
                },
            })
        const first = stub('FROM THE FIRST DEPLOYMENT')
        const second = stub('FROM THE SECOND DEPLOYMENT')
        const firstUrl = `http://localhost:${first.port}`
        const secondUrl = `http://localhost:${second.port}`

        try {
            // WHERE and WHO are two commands. `connect` never touches a credential …
            const connected = await run(executable, ['connect', firstUrl], { env })
            expect(connected.code).toBe(0)
            expect(connected.stdout).toContain(`connected to ${firstUrl}`)

            // … `login` stores one, keyed by the origin it is for.
            const loggedIn = await run(executable, ['login', '--token', 'sealed-token'], { env })
            expect(loggedIn.code).toBe(0)
            expect(loggedIn.stdout).toContain(`logged in at ${firstUrl}`)

            // The credential is at rest in a per-user file — it must not be world-readable.
            const stored = join(dataDir, 'demoapp.target.json')
            expect(statSync(stored).mode & 0o777).toBe(0o600)

            // A LATER, otherwise-bare run reaches the stored deployment — the point of the feature —
            // and carries the stored bearer.
            const stayed = await run(executable, ['greet', '--name', 'stored'], { env })
            expect(stayed.code).toBe(0)
            expect(stayed.stdout.trim()).toBe('"FROM THE FIRST DEPLOYMENT"')
            expect(authorizations.at(-1)).toBe('Bearer sealed-token')

            // `identity` asks the server who that credential makes you — the only honest way to know,
            // since the CLI cannot read its own sealed token.
            const who = await run(executable, ['identity'], { env })
            expect(who.code).toBe(0)
            expect(JSON.parse(who.stdout)).toEqual({ id: 'stub-user', authenticated: true })

            // Bare `connect` reports rather than sets.
            const reported = await run(executable, ['connect'], { env })
            expect(reported.stdout).toContain(`connected to ${firstUrl}`)
            expect(reported.stdout).toContain('logged in')

            // The ladder: an env var outranks the stored target, and a flag outranks both.
            const viaEnv = await run(executable, ['greet'], {
                env: { ...env, ABIDE_APP_URL: secondUrl },
            })
            expect(viaEnv.stdout.trim()).toBe('"FROM THE SECOND DEPLOYMENT"')

            // From the prompt, `connect` re-points the live session (not just the file).
            const session = await run(executable, [], {
                stdin: `connect ${secondUrl}\ngreet --name repl\nexit\n`,
                env,
            })
            expect(session.stdout).toContain('"FROM THE SECOND DEPLOYMENT"')

            // A credential belongs to its ORIGIN: moving to the second deployment carries no login,
            // and moving back would still find the first one.
            const unauthenticated = await run(executable, ['greet'], { env })
            expect(unauthenticated.code).toBe(0)
            expect(authorizations.at(-1)).toBeNull()

            const gone = await run(executable, ['disconnect'], { env })
            expect(gone.code).toBe(0)
            expect(gone.stdout).toContain(`disconnected from ${secondUrl}`)

            // `logout` is the other axis: reconnect to the first deployment, drop only its credential.
            await run(executable, ['connect', firstUrl], { env })
            const loggedOut = await run(executable, ['logout'], { env })
            expect(loggedOut.code).toBe(0)
            expect(loggedOut.stdout).toContain('still valid until it expires')
            await run(executable, ['greet'], { env })
            expect(authorizations.at(-1)).toBeNull()
            await run(executable, ['disconnect'], { env })

            // Back to hosting the app itself: the answer now comes from the embedded rpc.
            const local = await run(executable, ['greet', '--name', 'local'], { env })
            expect(local.stdout.trim()).toBe('"Hello, local!"')
        } finally {
            first.stop(true)
            second.stop(true)
        }
    }, 180_000)

    test('a bare run with no console and no stdin fails loudly rather than exiting 0', async () => {
        const dir = await fixtureProject()
        const runDir = tempPath('cli-nostdin-out')
        await mkdir(runDir, { recursive: true })
        const executable = join(runDir, 'demoapp')
        await compile(dir, { out: executable })
        await rm(dir, { recursive: true, force: true })

        // A container running the binary as its entrypoint: no arguments, no TTY, stdin closed. The
        // REPL would otherwise read EOF and "succeed" instantly, which an orchestrator reads as a clean
        // exit and restart-loops in silence.
        const session = await run(executable, [])
        expect(session.code).toBe(2)
        expect(session.stderr).toContain('nothing to read on stdin')
        expect(session.stderr).toContain('demoapp serve')
    }, 180_000)

    test('--url / ABIDE_APP_URL target a deployment instead of booting the embedded server', async () => {
        const dir = await fixtureProject()
        const runDir = tempPath('cli-remote-out')
        await mkdir(runDir, { recursive: true })
        const executable = join(runDir, 'demoapp')
        await compile(dir, { out: executable })
        await rm(dir, { recursive: true, force: true })

        // A stand-in "deployment" that answers differently from the embedded app, so the assertion
        // proves WHERE the call went rather than just that it succeeded.
        const seen: string[] = []
        const remote = Bun.serve({
            port: 0,
            fetch(request) {
                const url = new URL(request.url)
                seen.push(url.pathname + url.search)
                return Response.json('Hello from the deployment!')
            },
        })
        try {
            const origin = `http://localhost:${remote.port}`
            const flag = await run(executable, ['--url', origin, 'greet', '--name', 'abide'])
            expect(flag.code).toBe(0)
            expect(flag.stdout.trim()).toBe('"Hello from the deployment!"')
            expect(seen[0]).toContain('/__abide/rpc/greet')
            expect(seen[0]).toContain('__abide_args')

            const env = await run(executable, ['greet'], { env: { ABIDE_APP_URL: origin } })
            expect(env.code).toBe(0)
            expect(env.stdout.trim()).toBe('"Hello from the deployment!"')
        } finally {
            remote.stop(true)
        }
    }, 180_000)
})
