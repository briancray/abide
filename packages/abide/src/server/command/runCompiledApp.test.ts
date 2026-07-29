// `runCompiledApp` — the entry point of EVERY compiled binary, exercised IN-PROCESS.
//
// It had no tests, and could not have any: it read `Bun.argv` directly and called `process.exit` at
// four sites, so reaching it meant compiling a binary and spawning it. Its twin `interactiveCli` — the
// other half of the same command surface — took `input`/`write`/`writeError` as options and was tested.
// The asymmetry had no stated reason.
//
// It now takes the same injection and RETURNS an exit code (`null` = this branch is long-lived and the
// process must stay alive), which is what makes the branches below reachable from a test at all. Only
// the paths that must NOT boot the app are covered here — help, completion, usage — because those are
// exactly the ones whose contract is "answer without running `onStart`", and a test that booted an app
// could not tell the difference.

import { describe, expect, test } from 'bun:test'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import type { CompiledApp } from './compiledAppConfig.ts'
import { runCompiledApp } from './runCompiledApp.ts'

// The minimum a compiled binary carries. No rpcs, no pages: every branch asserted here answers off the
// command table alone, and giving it surfaces would only add ways for the test to boot something.
const APP: CompiledApp = {
    dir: '/compiled',
    name: 'demoapp',
    rpc: [],
    sockets: [],
    pages: {},
    pageDirs: {},
    layouts: {},
    layoutDirs: {},
    modules: [],
    schemas: {},
    client: { entry: 'loader-abc.js', css: null, chunkByPattern: {} },
    assets: [],
    publicFiles: {},
}

// Run the dispatcher with captured IO. `stdoutIsTty: false` pins the compact/pipe defaults so the
// assertions do not depend on whether the suite is attached to a terminal.
async function run(argv: string[]): Promise<{ code: number | null; out: string; err: string }> {
    let out = ''
    let err = ''
    const code = await runCompiledApp(APP, {
        argv,
        write: (text) => {
            out += text
        },
        writeError: (text) => {
            err += text
        },
        stdoutIsTty: false,
        stdinIsTty: false,
    })
    return { code, out, err }
}

describe('help', () => {
    test('`help` prints usage to stdout and succeeds', async () => {
        const { code, out, err } = await run(['help'])
        expect(code).toBe(CLI_EXIT_CODES.ok)
        expect(out).toContain('demoapp')
        expect(err).toBe('')
    })

    // Asking for help is a SUCCESS; getting the command wrong is not. The same rule the `abide` CLI
    // follows — a mistyped command that exits 0 tells a CI script the build succeeded.
    test('`--help` reaches the same text from before the subcommand', async () => {
        const { code, out } = await run(['--help'])
        expect(code).toBe(CLI_EXIT_CODES.ok)
        expect(out).toContain('demoapp')
    })

    // `serve --help` used to BOOT THE SERVER: `parseGlobals` stops reading globals at the subcommand
    // (so an rpc may own `--url`), `runOnce` re-checked `--help` for an RPC, and no branch re-checked it
    // for a RESERVED name. A `null` code here would mean the long-lived serve branch ran — which is why
    // this asserts the code and not just the text.
    test.each([['serve'], ['logs'], ['identity'], ['connect']])(
        '`%s --help` prints usage instead of RUNNING the command',
        async (command) => {
            const { code, out } = await run([command, '--help'])
            expect(code).toBe(CLI_EXIT_CODES.ok)
            expect(out).toContain('demoapp')
        },
    )

    test('`-h` after a reserved command does the same', async () => {
        const { code } = await run(['serve', '-h'])
        expect(code).toBe(CLI_EXIT_CODES.ok)
    })
})

describe('completion — answers without booting the app', () => {
    test.each([['bash'], ['zsh'], ['fish']])('`completion %s` emits a script', async (shell) => {
        const { code, out } = await run(['completion', shell])
        expect(code).toBe(CLI_EXIT_CODES.ok)
        expect(out.length).toBeGreaterThan(0)
        expect(out).toContain('demoapp')
    })

    test('an unknown shell is a USAGE error on stderr, not a success', async () => {
        const { code, out, err } = await run(['completion', 'tcsh'])
        expect(code).toBe(CLI_EXIT_CODES.usage)
        expect(err).toContain('completion')
        expect(out).toBe('')
    })

    // The TAB callback. The generated script delegates back here on every keystroke rather than baking
    // names in, so this must answer from the live command table and must never run `onStart`.
    // The generated shell script strips the program name before delegating ("the completer answers
    // about the COMMAND line, not the invocation"), so the line is what follows the binary.
    test('`completion --line` answers candidates for the partial line', async () => {
        const { code, out } = await run(['completion', '--line', 'hel'])
        expect(code).toBe(CLI_EXIT_CODES.ok)
        expect(out).toContain('help')
    })
})

describe('an unknown command', () => {
    test('reports on stderr and exits with the usage class', async () => {
        const { code, err } = await run(['definitely-not-a-command'])
        expect(code).toBe(CLI_EXIT_CODES.usage)
        expect(err).toContain('unknown command')
        expect(err).toContain('definitely-not-a-command')
    })
})
