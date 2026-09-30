// 38.59, 38.60, 38.62 — WHAT `abide start` SAYS: the addresses first, a shell that answers `help`
// with what it takes, and a call's `name=value` args read as the handler declares them. Driven over
// a pipe, which is the shell with no panel — 38.61's is a terminal's, and no pipe can show a prompt
// staying put.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { appFixture, BIN, buildApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

let app = ''

beforeAll(() => {
    app = appFixture({
        'ui/pages/page.abide': '<main>home</main>',
        'server/rpc/greetings.ts': `import { GET, POST } from 'abide/server'

export const hello = GET(() => 'hello')
export const remember = POST((args: { name: string }) => args.name)
export const add = POST((args: { a: number; b: number }) => args.a + args.b, {
    description: 'Adds two numbers.',
})
`,
    })
    const built = buildApp(app)
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr}`)
}, 30_000)

afterAll(removeTemporaryModules)

// RUN FROM ELSEWHERE, so the handler table is the one `--root` names and not the one under the
// working directory. THE REVERT: drop `help` from the shell's words and it answers `unknown: help`;
// read the table from `process.cwd()` and `handlers` answers that there are none.
test('start prints its address, then help, handlers and a name=value call answer — 38.59, 38.60, 38.62', async () => {
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
    // 38.62 — THE REVERT: send the words' text uncoerced, and `add` answers "23".
    expect(printed).toContain('\n5\n')
    expect(printed).toContain('"Ada Lovelace"')
}, 30_000)
