// The binary, as a binary.
//
// Everything here is SPAWNED, because every claim the CLI makes is about a process: what it printed,
// which stream it printed on, and what the shell learned when it ended. `cli(argv)` returning a
// number is testable in-process and it is the less interesting half — an exit code that never
// reaches `process.exit` is a number nobody acts on.
//
// Reached through `abide/cli`, the public specifier, so a broken entry point fails here rather than
// being papered over by a path.

import { expect, test } from 'bun:test'
import { CLI_EXIT_CODES, COMMANDS, exitForStatus, LineEditor, suggest } from 'abide/cli'
import { abide, BINARY, type Ended, ended, firstLine, linesUntil, spawn } from 'harness/spawn'
import { FIXTURES, TYPES } from '#tests/PATHS.ts'

const LOGS_APP = `${import.meta.dir}/cli-logs-app.ts`

// NOT spawned, and the one thing in this file that is not. `exitForStatus` is a pure function of one
// number, so a process around it would test the process; and it cannot go in `packages/dogfood/src/shared/demos`
// the way the rest of the dogfood does, because `abide/cli` is bun-only and a demo is bundled for the
// browser too — the same reason `abide/runtime/transport` has its own specifier. Table-driven because
// this is a SHELL CONTRACT: a script branching on `4` breaks the day two builds disagree about what
// `4` meant, and five of these eight codes were reachable from no test at all — abide itself never
// answers 504, so `timeout` is only ever produced by an intermediary in front of the app.
test('an HTTP answer is the code the shell sees, for every code in the table', () => {
    const table: [number, number][] = [
        [200, CLI_EXIT_CODES.ok],
        [204, CLI_EXIT_CODES.ok],
        // A redirect is not an outcome: one the fetch followed is invisible, and one it did not is a
        // response the command chose not to follow. Neither is the command failing.
        [301, CLI_EXIT_CODES.ok],
        [399, CLI_EXIT_CODES.ok],
        [401, CLI_EXIT_CODES.denied],
        [403, CLI_EXIT_CODES.denied],
        [404, CLI_EXIT_CODES.missing],
        [422, CLI_EXIT_CODES.invalid],
        [504, CLI_EXIT_CODES.timeout],
        [500, CLI_EXIT_CODES.server],
        [503, CLI_EXIT_CODES.server],
        // Ordered against `>= 500`: 504 is a timeout before it is a server error, and the two 4xx
        // that are not `denied`/`missing`/`invalid` fall through to `client` rather than to `failed`.
        [400, CLI_EXIT_CODES.client],
        [418, CLI_EXIT_CODES.client],
        [429, CLI_EXIT_CODES.client],
    ]
    for (const [status, code] of table) {
        expect([status, exitForStatus(status)]).toEqual([status, code])
    }

    // The numbers themselves, because renumbering the table is the silent break — every assertion
    // above would still pass with `denied` and `invalid` swapped.
    expect(CLI_EXIT_CODES).toEqual({
        ok: 0,
        failed: 1,
        usage: 2,
        invalid: 3,
        denied: 4,
        missing: 5,
        timeout: 6,
        server: 7,
        client: 8,
    })
})

test('the usage screen is the command table, and asking for it is a success', async () => {
    const asked = await abide(['--help'])
    expect(asked.code).toBe(0)
    // stdout, because somebody ASKED — a help screen on stderr is one `abide --help | less` misses.
    expect(asked.err).toBe('')

    // Generated from the table rather than written beside it: every row is on the screen, and a row
    // added without a line of formatting being touched is what that buys.
    for (const command of COMMANDS) {
        expect(asked.out).toContain(command.name)
        expect(asked.out).toContain(command.blurb)
    }
    // Not a terminal, so no escapes in it.
    expect(asked.out).not.toContain('\x1b[')

    // The bare call is the same screen and the same success.
    const bare = await abide([])
    expect(bare.out).toBe(asked.out)
    expect(bare.code).toBe(0)
})

test('an unknown command is a usage failure, not a success', async () => {
    const asked = await abide(['deploy'])
    // `2`, and the whole reason it is not `0`: a mistyped command exiting `0` tells CI the build
    // succeeded. Not `1` either — nothing ran.
    expect(asked.code).toBe(2)
    expect(asked.err).toContain('deploy')
    expect(asked.out).toBe('')
})

test('`run` puts a script under the runtime, and hands it its own arguments', async () => {
    const script = `${import.meta.dir}/cli_run_probe.ts`
    await Bun.write(
        script,
        // The import is the claim: a `.abide` file resolves in the spawned process, so the loader is
        // installed by the command rather than by this repo's `bunfig.toml`.
        `import Card from '${FIXTURES}/card.abide'\n` +
            `console.log(JSON.stringify({ card: typeof Card, argv: Bun.argv.slice(2) }))\n` +
            `process.exit(3)\n`,
    )
    try {
        const ran = await abide(['run', script, '--help', '-n', '3'])
        expect(JSON.parse(ran.out.trim())).toEqual({ card: 'function', argv: ['--help', '-n', '3'] })
        // Everything after the file belongs to the SCRIPT — including `--help`, which this binary
        // answers to itself and must not answer to here.
        expect(ran.out).not.toContain('usage:')
        // A script that chose an exit code keeps it: the command is a runtime, not an outcome.
        expect(ran.code).toBe(3)
    } finally {
        await Bun.file(script).delete()
    }

    const nothing = await abide(['run'])
    expect(nothing.code).toBe(2)
    expect(nothing.err).toContain('needs a file')
})

test('`check` reports a `.abide` type error on the `.abide` line', async () => {
    // The fixtures under `types/invalid` are code that MUST be rejected, and they carry their own
    // tsconfig — so this runs the real checker over eight small files rather than the whole repo, and
    // says nothing about whether the repo itself is green.
    const checked = await abide(['check', '.'], { cwd: `${TYPES}/invalid` })
    expect(checked.code).toBe(1)
    // Diagnostics are this command's OUTPUT, not its complaint: stdout is what an editor pipes.
    expect(checked.out).toContain('.abide(')
    expect(checked.out).toMatch(/narrowing\.abide\(9,\d+\): error TS2339/)
    expect(checked.err).toBe('')
})

test('a flag no command declares is REFUSED, never silently dropped', async () => {
    // `check` used to `filter` these out, so `abide check --lint` ran a full check of the working
    // directory and said nothing about the flag — the failure `build`'s own comment describes, from
    // the other side. Both take the same `[dir…]` shape and now answer through the same code.
    const invalid = `${TYPES}/invalid`
    const checked = await abide(['check', '--lint', '.'], { cwd: invalid })
    expect(checked.code).toBe(2)
    expect(checked.err).toContain('unknown option `--lint`')
    // Nothing RAN: a refused command must not also emit the diagnostics of the check it declined.
    expect(checked.out).toBe('')

    const built = await abide(['build', '--minify'])
    expect(built.code).toBe(2)
    expect(built.err).toContain('unknown option `--minify`')

    // The usage line is the command's own `args` from the table, so a refusal and the help screen
    // cannot disagree about how the command is spelled.
    for (const [name, spelling] of [
        ['check', '[dir…]'],
        ['build', '[entry…]'],
    ] as const) {
        expect(COMMANDS.find((one) => one.name === name)?.args).toBe(spelling)
    }
    expect(checked.err).toContain('usage: abide check [dir…]')
    expect(built.err).toContain('usage: abide build [entry…]')
})

test('asking a COMMAND for help is a success, and answers with that command', async () => {
    // `abide dev --help` used to exit `2` with `unknown option --help` — the code that means "you
    // typed it wrong" answering the request for how to type it.
    for (const command of COMMANDS) {
        if (command.name === 'run') continue // opaque arguments; covered by the `run` case above.
        const asked = await abide([command.name, '--help'])
        expect(asked.code).toBe(0)
        expect(asked.err).toBe('')
        expect(asked.out).toContain(`abide ${command.name}`)
        expect(asked.out).toContain(command.blurb)
    }
})

test('`logs` tails the feed the app is serving, replay first and live after', async () => {
    // Named, and the name is the assertion below: the CHANNEL crosses the wire on the record. A tail
    // that rebuilt it would answer with its own process's app name, which is not the app.
    const app = spawn(['bun', LOGS_APP], {
        env: { ABIDE_LOGS: '1', ABIDE_LOG_FORMAT: 'tsv', ABIDE_APP_NAME: 'tailed' },
    })
    const port = await firstLine(app.stdout)

    try {
        const tail = spawn(['bun', BINARY, 'logs'], {
            env: {
                ABIDE_APP_URL: `http://localhost:${(JSON.parse(port) as { port: number }).port}`,
                // Not a terminal, so the shape would be `tsv` anyway — declared so the assertion below
                // is about the five fields rather than about what the CI runner's stdout happens to be.
                ABIDE_LOG_FORMAT: 'tsv',
            },
        })
        const lines = await linesUntil(tail.stdout, 3)
        tail.kill()

        // Five tab-separated fields on every line, always — that is the contract `cut -f` reads.
        for (const line of lines) expect(line.split('\t')).toHaveLength(5)

        const messages = lines.map((line) => line.split('\t')[3])
        // The ring replayed what was written before this process existed…
        expect(messages[0]).toBe('written before anyone was listening')
        // …and the subscribe carried on from there, in order.
        expect(messages[1]).toBe('tick 1')
        expect(messages[2]).toBe('tick 2')

        // The channel is the APP's own name rather than this process's, and the level and the time
        // came across as themselves.
        const fields = (lines[0] as string).split('\t')
        expect(fields[1]).toBe('log')
        expect(fields[2]).toBe('tailed')
        expect(Number.isFinite(Date.parse(fields[0] as string))).toBe(true)
    } finally {
        app.kill()
    }
})

test('a closed feed and an app that is not there are different answers', async () => {
    // No `ABIDE_LOGS`, so the endpoint is not there rather than refusing — a 404, and `5`.
    const app = spawn(['bun', LOGS_APP])
    const port = (JSON.parse(await firstLine(app.stdout)) as { port: number }).port
    try {
        const closed = await abide(['logs'], { env: { ABIDE_APP_URL: `http://localhost:${port}` } })
        expect(closed.code).toBe(5)
        expect(closed.err).toContain('ABIDE_LOGS')
    } finally {
        app.kill()
    }

    // Nothing answered at all: no status, so no status to map — which is what `1` is for.
    const dead = await abide(['logs'], { env: { ABIDE_APP_URL: 'http://127.0.0.1:1' } })
    expect(dead.code).toBe(1)
    expect(dead.err).toContain('did not answer')

    // It takes no arguments, and saying so is a usage failure rather than a silent ignore.
    const extra = await abide(['logs', '--follow'])
    expect(extra.code).toBe(2)
})

test('`repl` keeps what a line declared, and prints what the next one is', async () => {
    const said = await replies([
        'const rows = [1, 2, 3]',
        'rows.length',
        // A declaration prints nothing; the value of an expression is the whole output of a prompt.
        'const doubled = rows.map((n) => n * 2)',
        'doubled',
        // An object literal is a BLOCK in statement position everywhere else in JavaScript. Here it
        // is the thing you meant.
        '{ a: 1 }',
        // Multi-line: the input is held until it PARSES, which the transpiler decides rather than a
        // bracket counter of our own.
        'const held = {',
        '  deep: { value: 4 },',
        '}',
        'held.deep.value',
    ])
    expect(said.out).toBe('3\n[ 2, 4, 6 ]\n{\n  a: 1,\n}\n4\n')
    expect(said.code).toBe(0)
})

test('`repl` has the abide surface in scope, and prints a source as one', async () => {
    const said = await replies([
        'const count = state(1)',
        // Naming a cell hands back the CELL, and the prompt says what it is holding rather than
        // `[Function]` — read through `peek`, so printing one starts nothing.
        'count',
        'count.set(4)',
        'count',
        // A memo that nobody has read is COLD, which is a different thing from holding `undefined`.
        'const rows = memo(() => [1, 2])',
        'rows',
        'rows()',
        'const feed = channel()',
        'feed',
    ])
    expect(said.out.split('\n')).toEqual([
        'state 1',
        'state 4',
        'memo (cold)',
        '[ 1, 2 ]',
        'channel (nothing yet)',
        '',
    ])
})

test('`repl` runs a top-level await, and keeps the name it landed in', async () => {
    const said = await replies([
        'await Promise.resolve(1) + 41',
        // The line that awaits is COMPILED differently — a plain statement cannot hold a top-level
        // await — and the name still has to survive into the next line.
        'const landed = await Promise.resolve("here")',
        'landed',
        // A cell is thenable, so a prompt that awaited every result would print what is INSIDE the
        // cell instead of the cell.
        'const held = state(7)',
        'held',
    ])
    expect(said.out.split('\n')).toEqual(['42', '"here"', 'state 7', ''])
})

test('`repl` imports a `.abide` file, resolved against where the prompt was opened', async () => {
    // The point of the command: the loader is registered, and a specifier means what it would mean
    // in the project you are standing in rather than beside the CLI's own source.
    const said = await replies(
        ['const Card = (await import("./Card.abide")).default', 'typeof Card'],
        FIXTURES,
    )
    expect(said.out.trim()).toBe('"function"')
    expect(said.code).toBe(0)
})

test('`repl` survives what a line got wrong, and says what it cannot be', async () => {
    const broken = await replies(['nope()', '"carried on"'])
    expect(broken.err).toContain('ReferenceError')
    expect(broken.out).toContain('"carried on"')
    // A session that was HANDED its input has nobody watching the errors go past, so it ends `1`.
    expect(broken.code).toBe(1)

    // A repl line is not a module, and the message is the way out rather than a parse error.
    const imported = await replies(['import { state } from "abide"'])
    expect(imported.err).toContain("await import('…')")

    // Input that stopped mid-line is not silently thrown away.
    const cut = await replies(['const half = ('])
    expect(cut.err).toContain('ended in the middle')
    expect(cut.code).toBe(1)
})

test('the line editor draws a ghost, takes it, and remembers what was entered', async () => {
    const painted: string[] = []
    const entered: string[] = []
    const editor = new LineEditor(
        {
            write: (text) => void painted.push(text),
            complete: (prefix) => suggest(prefix, ['state', 'status', 'channel']),
            onLine: (line) => void entered.push(line),
            onInterrupt: () => void entered.push('<interrupt>'),
            onEnd: () => void entered.push('<end>'),
        },
        true,
    )

    editor.feed('sta')
    // Two candidates share the prefix, and the SHORTER one is offered — a suggestion that moved as
    // the candidate list was reordered is one nobody could learn.
    expect(painted[painted.length - 1]).toContain('sta\x1b[90mte\x1b[0m')
    editor.feed('\t')
    editor.feed('\r')
    expect(entered).toEqual(['state'])

    // Backspace, then the history: what was entered comes back on an up arrow, and leaves again on
    // the way down.
    editor.feed('chan\x7f\x7f')
    expect(painted[painted.length - 1]).toContain('ch\x1b[90mannel\x1b[0m')
    editor.feed('\x1b[A')
    expect(painted[painted.length - 1]).toContain('state')
    editor.feed('\x1b[B\r')
    expect(entered).toEqual(['state', 'ch'])

    // A member is not a name in scope: nothing here can say what `x.sta` completes to without
    // evaluating `x`, which a keystroke must not do.
    editor.feed('\x15x.sta')
    expect(painted[painted.length - 1]).not.toContain('\x1b[90m')

    // Ctrl-C abandons the line; Ctrl-D on an empty one is the way out.
    editor.feed('\x15abc\x03')
    editor.feed('\x04')
    expect(entered).toEqual(['state', 'ch', '<interrupt>', '<end>'])
})

test('a ghost is only drawn where it can be told apart from what was typed', () => {
    // `suggest` is the whole rule: the shortest completion, nothing for an exact match, nothing for
    // an empty prefix — which is what stops a prompt suggesting the alphabet.
    expect(suggest('st', ['state', 'status'])).toBe('ate')
    expect(suggest('state', ['state'])).toBe('')
    expect(suggest('', ['state'])).toBe('')
    expect(suggest('zz', ['state'])).toBe('')

    const painted: string[] = []
    // Without color there is no ghost at all: an undimmed suggestion is indistinguishable from what
    // you typed, and a line editor that lies about which characters are yours is worse than one
    // making no suggestions.
    const plain = new LineEditor(
        {
            write: (text) => void painted.push(text),
            complete: (prefix) => suggest(prefix, ['state']),
            onLine: () => {},
            onInterrupt: () => {},
            onEnd: () => {},
        },
        false,
    )
    plain.feed('st')
    expect(painted[painted.length - 1]).not.toContain('ate')
})

/** A repl session fed lines the way a heredoc would, which is the one lane a test can drive. */
function replies(lines: string[], cwd?: string): Promise<Ended> {
    // Its own spawn rather than the shared one, for the one thing that helper does not model: a repl
    // is driven by what is fed to its STDIN, which is the only lane a test has on a line editor.
    return ended(
        Bun.spawn(['bun', BINARY, 'repl'], {
            stdin: new TextEncoder().encode(`${lines.join('\n')}\n`),
            stdout: 'pipe',
            stderr: 'pipe',
            ...(cwd === undefined ? {} : { cwd }),
            env: { ...Bun.env, NO_COLOR: '1' },
        }),
    )
}
