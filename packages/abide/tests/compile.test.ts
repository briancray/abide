// 38.10 — `abide compile`: the app as ONE executable, named after it, in the directory the command
// ran from — and holding everything it serves. The app's source and its build are deleted before
// the executable starts, so every answer below came out of the executable itself.
//
// THE REVERT: hand `runCompiled` the build's paths on disk rather than the entry's imports; every
// answer after the delete is then a 404 or a failed boot. And the identity — boot a compiled app with
// `APP_PACKAGE` left as the empty default and `name` answers `app`.
//
// THE SERVED EXECUTABLE IS STARTED WITH NO COMMAND AND NO INPUT, so every answer below is also 38.55's
// half of the shell: input that ends leaves the app serving.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { readdirSync, rmSync } from 'node:fs' // bun has no sync listing or recursive removal of its own
import { spawned } from '@abide/harness/gate'
import { addressOf, appFixture, BIN } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const NAME = `import { config, GET } from '@abide/abide/server'

export default GET(() => config().APP_NAME)
`

const FAIL = `import { GET } from '@abide/abide/server'

export default GET(() => {
    throw new Error('failed in the handler')
})
`

// A handler module no script below imports: its top level speaks on stderr if it ever runs.
const UNTOUCHED = `import { GET } from '@abide/abide/server'

console.error('untouched handler module ran')
export default GET(() => 'untouched')
`

const HOOKS = `import { middleware, onStart } from '@abide/abide/server'

let started = false
onStart(async (start) => {
    await start()
    started = true
})

middleware((next, { request: asked }) =>
    new URL(asked.url).pathname === '/own' ? new Response(\`own route, started \${started}\`) : next(),
)
`

let base = ''
let stop = (): void => {}
let listed: string[] = []
let where = ''

beforeAll(async () => {
    // UNDER `src/`, so the build lands beside it in `app/.abide` and is deleted with the source.
    const app = temporaryModule({
        'package.json': JSON.stringify({
            name: '@acme/ledger',
            type: 'module',
            imports: { '#src/*': './src/*' },
        }),
        'src/index.abide': '<main><h1>compiled</h1></main>',
        'src/public/robots.txt': 'User-agent: *\n',
        'src/identity/name.ts': NAME,
        'src/identity/fail.ts': FAIL,
        'src/untouched/untouched.ts': UNTOUCHED,
        'src/layout.abide': `<script server>\n${HOOKS}</script>\n`,
    })
    where = temporaryModule({})
    const compiled = await spawned(
        ['bun', BIN, 'compile', '--root', `${app}/src`],
        {
            cwd: where,
            env: process.env,
        },
    )
    if (compiled.exitCode !== 0)
        throw new Error(`abide compile failed: ${compiled.stderr}`)
    listed = readdirSync(where)
    rmSync(app, { recursive: true, force: true })

    const served = Bun.spawn([`${where}/ledger`, '--port', '0'], {
        cwd: where,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    })
    stop = () => served.kill('SIGKILL')
    base = await addressOf(served)
}, 60_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

test('one file, named after the app without its scope, where the command ran — 38.10', () => {
    expect(listed).toEqual(['ledger'])
})

test('the executable serves its pages, bundle and public files with no build on disk — 38.10', async () => {
    const page = await Bun.fetch(`${base}/`)
    expect(page.status).toBe(200)
    const document = await page.text()
    expect(document).toContain('<h1>compiled</h1>')

    const entry = /src="(\/__abide\/client\/entry-[^"]+\.js)"/.exec(document)
    expect(entry).not.toBeNull()
    const script = await Bun.fetch(`${base}${entry?.[1]}`, {
        headers: { 'accept-encoding': 'br' },
    })
    expect(script.status).toBe(200)
    expect(script.headers.get('content-encoding')).toBe('br')
    expect(script.headers.get('content-type')).toStartWith('text/javascript')

    const robots = await Bun.fetch(`${base}/robots.txt`)
    expect(robots.headers.get('content-type')).toStartWith('text/plain')
    expect(await robots.text()).toBe('User-agent: *\n')
})

test('the executable runs the app hooks and handlers it was compiled with — 38.10, 37.1, 27.3', async () => {
    expect(await (await Bun.fetch(`${base}/own`)).text()).toBe(
        'own route, started true',
    )
    const name = await Bun.fetch(`${base}/identity/name`)
    expect(await name.json()).toBe('@acme/ledger')
})

test('--target and --platforms together are refused — 38.10', async () => {
    const refused = await spawned([
        'bun',
        BIN,
        'compile',
        '--root',
        appFixture({}),
        '--target',
        'linux-x64',
        '--platforms',
        'linux-x64,darwin-arm64',
    ])
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr).toContain('give one of them')
})

// 38.50 — THE EXECUTABLE'S COMMAND LINE IS `abide`'s, spoken under its own name.
test('the executable prints usage of what it runs, and refuses a command it does not know — 38.50, 38.52, 38.12', async () => {
    const helped = await spawned([`${where}/ledger`, '--help'], { cwd: where })
    expect(helped.exitCode).toBe(0)
    const usage = helped.stdout
    expect(usage).toStartWith('ledger <command>')
    for (const command of [
        'start',
        'run <file>',
        'call <address>',
        'watch <address>',
    ])
        expect(usage).toContain(`  ${command}`)
    // 38.52 — nothing listed that the executable only refuses.
    for (const command of [
        'dev',
        'build',
        'check',
        'compile',
        'lsp',
        'scaffold',
        'bundle',
    ])
        expect(usage).not.toContain(`  ${command}`)
    for (const flag of ['--root', '--target', '--platforms'])
        expect(usage).not.toContain(flag)

    const unknown = await spawned([`${where}/ledger`, 'frobnicate'], {
        cwd: where,
    })
    expect(unknown.exitCode).toBe(1)
    expect(unknown.stderr).toContain("ledger: unknown command 'frobnicate'")
})

test('a command that needs the source is refused, naming abide — 38.51', async () => {
    const build = await spawned([`${where}/ledger`, 'build'], { cwd: where })
    expect(build.exitCode).toBe(1)
    expect(build.stderr).toContain('Run `abide build`')
})

// 38.53, 38.54 — THE EXECUTABLE ALONE OPENS THE SHELL ON THE APP IT SERVES, and `exit` in it stops
// the app and ends the process with 0. THE REVERT: serve without the shell, as `start` does; nothing
// reads the input and the process is `still serving` when the bound runs out.
test('the executable alone opens a shell on the app it serves, and exit stops it — 38.53, 38.54', async () => {
    const started = Bun.spawn([`${where}/ledger`, '--port', '0'], {
        cwd: where,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: process.env,
    })
    started.stdin.write('call identity/name\nexit\n')
    started.stdin.end()
    // BOUNDED, so a shell that never opens fails here rather than hanging the suite.
    const exited = await Promise.race([
        started.exited,
        Bun.sleep(10_000).then(() => 'still serving'),
    ])
    started.kill('SIGKILL')
    expect(exited).toBe(0)
    expect(await Bun.readableStreamToText(started.stdout)).toContain(
        '"@acme/ledger"',
    )
}, 30_000)

// 38.56, 38.57 — A SCRIPT RUN BY THE EXECUTABLE imports abide and the app's handlers out of it, and
// reads the configuration as the app it holds. THE REVERT: drop `config.invalidate()` from `run`;
// the name the script reads is `app`. And a handler module the script does not import never runs:
// load every specifier as the plugin is registered, and stderr reads `untouched handler module ran`.
test('run takes abide and the handlers from the executable, under its identity — 38.56, 38.57', async () => {
    await Bun.write(
        `${where}/script.ts`,
        `import { config } from '@abide/abide/server'
import name from '#src/identity/name.ts'
console.log(JSON.stringify({ configured: config().APP_NAME, handler: await name(), args: process.argv.slice(2) }))
`,
    )
    const ran = await spawned([`${where}/ledger`, 'run', 'script.ts', 'one'], {
        cwd: where,
    })
    expect(ran.stderr).toBe('')
    expect(JSON.parse(ran.stdout.trim())).toEqual({
        configured: '@acme/ledger',
        handler: '@acme/ledger',
        args: ['one'],
    })
})

// 38.93 — BYTECODE KEEPS THE SOURCE LINE: the executable carries its code compiled, and an error
// thrown in a handler still names the handler file it was written in, at its line. THE REVERT:
// `sourcemap: 'none'` in `compileExecutable`, and the frame reads `/$bunfs/root/ledger:10603`.
test('an error thrown in the executable reports its source line — 38.93', async () => {
    await Bun.write(
        `${where}/failing.ts`,
        `import fail from '#src/identity/fail.ts'
try {
    await fail()
} catch (error) {
    console.log((error as Error).stack)
}
`,
    )
    const ran = await spawned([`${where}/ledger`, 'run', 'failing.ts'], {
        cwd: where,
    })
    expect(ran.stdout).toContain('failed in the handler')
    // The line the `throw` is written on, in the file it is written in — the frame may carry the
    // suffix of the namespace the file was loaded through.
    expect(ran.stdout).toMatch(/identity\/fail\.ts:4:/)
})
