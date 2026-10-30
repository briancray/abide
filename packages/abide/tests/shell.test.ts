// 38.58, 38.59, 38.61 — WHAT `abide` ALONE SAYS: the addresses first, a shell that answers `help`
// with what it takes, and a call's `name=value` args read as the handler declares them. Driven over
// a pipe, which is the shell with no panel — 38.60's is a terminal's, and no pipe can show a prompt
// staying put.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { addressOf, appFixture, BIN, buildApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

let app = ''

beforeAll(async () => {
    app = appFixture({
        'index.abide': '<main>home</main>',
        'greetings/hello.handler.ts': `import { GET } from '@abide/abide/server'

export default GET(() => 'hello')
`,
        'greetings/remember.handler.ts': `import { POST } from '@abide/abide/server'

export default POST((args: { name: string }) => args.name)
`,
        'greetings/add.handler.ts': `import { POST } from '@abide/abide/server'

export default POST((args: { a: number; b: number }) => args.a + args.b, {
    description: 'Adds two numbers.',
})
`,
    })
    const built = await buildApp(app)
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr}`)
}, 30_000)

afterAll(removeTemporaryModules)

// RUN FROM ELSEWHERE, so the handler table is the one `--root` names and not the one under the
// working directory. THE REVERT: drop `help` from the shell's words and it answers `unknown: help`;
// read the table from `process.cwd()` and `handlers` answers that there are none.
test('abide alone serves, prints its address, then help, handlers and a name=value call answer — 38.58, 38.59, 38.61', async () => {
    const started = Bun.spawn(
        ['bun', BIN, '--root', app, '--out', `${app}/.abide`, '--port', '0'],
        {
            cwd: '/',
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            env: process.env,
        },
    )
    started.stdin.write(
        'help\nhandlers\ncall greetings/add a=2 b=3\ncall greetings/remember name="Ada Lovelace"\nexit\n',
    )
    started.stdin.end()
    const exited = await Promise.race([
        started.exited,
        Bun.sleep(10_000).then(() => 'still serving'),
    ])
    started.kill('SIGKILL')
    expect(exited).toBe(0)
    const printed = await Bun.readableStreamToText(started.stdout)
    expect(/http:\/\/\S+/.exec(printed)?.[0]).toStartWith('http://localhost:')
    for (const word of ['call <address> [args]', 'handlers', 'help', 'exit'])
        expect(printed).toContain(`  ${word}  `)
    expect(printed).not.toContain('unknown:')
    // The args each is typed with, and a literal description under it — THE REVERT: read no
    // description at build and the line under `add` is missing.
    expect(printed).toMatch(/ {2}greetings\/hello +no args\n/)
    expect(printed).toMatch(
        / {2}greetings\/add +a=<number> b=<number>\n +Adds two numbers\.\n/,
    )
    expect(printed).toMatch(/ {2}greetings\/remember +name=<string>\n/)
    // 38.61 — THE REVERT: send a mutation's words as a JSON body, which the app never coerces, and
    // `add` answers "23".
    expect(printed).toContain('\n5\n')
    expect(printed).toContain('"Ada Lovelace"')
}, 30_000)

// 38.67 — `start` ONLY SERVES: the `exit` piped to it is never read, and the process is still serving
// when the bound runs out. THE REVERT: open the shell from `start` too, and the `exit` stops the app
// with 0.
//
// 38.7 — `abide --url` IS THE SHELL ON THAT APP, BOOTING NOTHING: a call is answered by the app
// `start` serves, and no address of its own is printed. THE REVERT: ignore `--url`, and the shell
// serves the build itself and prints a `Local:` address.
test('start reads no input and keeps serving, and abide --url is a shell on it — 38.67, 38.7', async () => {
    const started = Bun.spawn(
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
            cwd: '/',
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            env: process.env,
        },
    )
    started.stdin.write('exit\n')
    started.stdin.end()
    const base = await addressOf(started)
    const exited = await Promise.race([
        started.exited,
        Bun.sleep(1_000).then(() => 'still serving'),
    ])
    const answered = await Bun.fetch(base).then(
        (response) => response.status,
        () => 'refused',
    )
    const connected = Bun.spawn(
        ['bun', BIN, '--root', app, '--out', `${app}/.abide`, '--url', base],
        {
            cwd: '/',
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
            env: process.env,
        },
    )
    connected.stdin.write('call greetings/add a=2 b=3\nexit\n')
    connected.stdin.end()
    const left = await Promise.race([
        connected.exited,
        Bun.sleep(10_000).then(() => 'still open'),
    ])
    connected.kill('SIGKILL')
    started.kill('SIGKILL')
    expect(exited).toBe('still serving')
    expect(answered).toBe(200)
    expect(left).toBe(0)
    const printed = await Bun.readableStreamToText(connected.stdout)
    expect(printed).toContain('\n5\n')
    expect(printed).not.toContain('Local:')
}, 30_000)
