// `main(argv)` — the `abide` dispatcher itself. Nothing invoked it before: the CLI tests reached past
// it for `build`/`scaffold`, so subcommand dispatch, the unknown-command exit code and the argv
// helpers were shipped untested. `main` now takes a `cwd` and a pair of writers, so the whole
// dispatcher runs in-process with no spawned shell.
//
// The scaffold cases pass `--no-git --no-install --no-dev` — with all three, scaffolding is pure file
// copying, so these exercise the real argv path (firstPositional/flagAbsent) without spawning git,
// bun, or a dev server.

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GET } from '../server/GET.ts'
import { cliCommands } from '../server/internal/cliCommands.ts'
import { cliUsage } from '../server/internal/cliUsage.ts'
import type { CommandTarget } from '../server/internal/commandTarget.ts'
import { interactiveCli } from '../server/internal/interactiveCli.ts'
import {
    RESERVED_CLI_COMMANDS,
    type ReservedCliCommand,
} from '../server/internal/RESERVED_CLI_COMMANDS.ts'
import { reservedCliCommand } from '../server/internal/reservedCliCommand.ts'
import type { Route } from '../server/internal/router.ts'
import { firstPositional } from './firstPositional.ts'
import { flagAbsent } from './flagAbsent.ts'
import { flagValue } from './flagValue.ts'
import { main } from './main.ts'

const tempDirs: string[] = []

function tempPath(): string {
    const dir = join(tmpdir(), `abide-main-${Bun.randomUUIDv7()}`)
    tempDirs.push(dir)
    return dir
}

interface Run {
    out: string
    err: string
    code: number
}

// Drive the dispatcher and collect everything it reported: stdout, stderr, and the exit code it left
// on `process.exitCode` — reset to 0 afterwards, or a `usage` asserted here fails the whole test run.
// Bun IGNORES `process.exitCode = undefined` once a number was assigned, so the reset must be `0`.
async function run(argv: string[], cwd?: string): Promise<Run> {
    const out: string[] = []
    const err: string[] = []
    process.exitCode = 0
    await main(argv, {
        cwd: cwd ?? tempPath(),
        write: (line) => out.push(line),
        writeError: (line) => err.push(line),
    })
    const code = typeof process.exitCode === 'number' ? process.exitCode : 0
    process.exitCode = 0
    return { out: out.join('\n'), err: err.join('\n'), code }
}

afterEach(() => {
    process.exitCode = 0
})

afterAll(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
})

describe('main — argv helpers', () => {
    test('firstPositional skips the value of every value-taking flag, not just --port', () => {
        expect(firstPositional(['demo'])).toBe('demo')
        expect(firstPositional(['--port', '4100', 'demo'])).toBe('demo')
        // The regression: `--port` used to be the only flag known to consume a value, so any other
        // value-taking flag donated its value as the positional.
        expect(firstPositional(['--out', 'dist', 'demo'])).toBe('demo')
        expect(firstPositional(['--target', 'bun-linux-x64', 'demo'])).toBe('demo')
        expect(firstPositional(['--no-git', 'demo'])).toBe('demo')
        expect(firstPositional(['--no-git'])).toBeUndefined()
        expect(firstPositional([])).toBeUndefined()
    })

    test('flagValue reads a trailing value and refuses a following flag', () => {
        expect(flagValue(['--target', 'bun-linux-x64'], '--target')).toBe('bun-linux-x64')
        expect(flagValue(['--target', '--out', 'x'], '--target')).toBeUndefined()
        expect(flagValue(['--target'], '--target')).toBeUndefined()
        expect(flagValue(['--out', 'x'], '--target')).toBeUndefined()
    })

    test('flagAbsent is presence, inverted', () => {
        expect(flagAbsent(['--no-git'], '--no-git')).toBe(false)
        expect(flagAbsent(['--no-install'], '--no-git')).toBe(true)
        expect(flagAbsent([], '--no-git')).toBe(true)
    })
})

describe('main — dispatch', () => {
    test('a bare invocation prints usage on stdout and succeeds', async () => {
        const result = await run([])
        expect(result.out).toContain('abide — isomorphic type-safe framework')
        expect(result.err).toBe('')
        expect(result.code).toBe(0)
    })

    test('-h / --help print usage on stdout and succeed', async () => {
        for (const flag of ['-h', '--help']) {
            const result = await run([flag])
            expect(result.out).toContain('Usage:')
            expect(result.code).toBe(0)
        }
    })

    test('an unknown command is a USAGE ERROR — stderr, exit 2', async () => {
        const result = await run(['biuld'])
        // It used to print usage on stdout and exit 0, so a typo in CI read as a successful build.
        expect(result.err).toContain('unknown command "biuld"')
        expect(result.err).toContain('Usage:')
        expect(result.out).toBe('')
        expect(result.code).toBe(2)
    })

    test('run without a <file> is a usage error', async () => {
        const result = await run(['run'])
        expect(result.err).toContain('abide run — usage')
        expect(result.code).toBe(2)
    })

    test('run passes everything after the file to the SCRIPT, not to abide', async () => {
        // `--port` here belongs to the migration, not to abide — `abide run` is the one command whose
        // trailing argv is somebody else's. Asserted at the dispatch layer because that is where the
        // split is decided; what the script then sees is `run.test.ts`'s business.
        const result = await run(['run', 'definitely-not-here.ts', '--port', '5'])
        expect(result.err).toContain('no such file: definitely-not-here.ts')
        expect(result.code).toBe(2)
    })

    test('scaffold without a <name> is a usage error, not help', async () => {
        const result = await run(['scaffold'])
        expect(result.err).toContain('missing project <name>')
        expect(result.code).toBe(2)
    })

    test('scaffold <name> with every step opted out just writes the project', async () => {
        const cwd = tempPath()
        const result = await run(['scaffold', 'demo', '--no-git', '--no-install', '--no-dev'], cwd)
        expect(result.code).toBe(0)
        expect(result.out).toContain(`created ${join(cwd, 'demo')}`)
        expect(result.out).toContain('cd demo && bun run dev')
        expect(await Bun.file(join(cwd, 'demo', 'package.json')).exists()).toBe(true)
        expect((await Bun.file(join(cwd, 'demo', 'package.json')).json()).name).toBe('demo')
    })

    test('scaffold reads <name> past a value-taking flag', async () => {
        const cwd = tempPath()
        // `--out` is not a scaffold flag, but firstPositional must still not mistake its value for the
        // project name — that is the whole point of a named value-flag list.
        const result = await run(
            ['scaffold', '--out', 'dist', 'demo', '--no-git', '--no-install', '--no-dev'],
            cwd,
        )
        expect(result.code).toBe(0)
        expect(await Bun.file(join(cwd, 'demo', 'package.json')).exists()).toBe(true)
        expect(await Bun.file(join(cwd, 'dist', 'package.json')).exists()).toBe(false)
    })
})

// The four places `RESERVED_CLI_COMMANDS` says have to agree. Two of them (the dispatcher and the
// REPL) now branch on `reservedCliCommand`, so their agreement is a compile error away rather than a
// convention; the other two read the table. This describes asserts the remaining half — that every
// name in the table reaches all four — so the comment in that file is a test, not a hope.
describe('reserved CLI commands — one list, four readers', () => {
    const RESERVED = Object.keys(RESERVED_CLI_COMMANDS)

    // Capture the `abide:cli` warn stream. It is channel-gated, and (under the happy-dom preload)
    // lands on console.warn rather than stderr — take both so this never silently captures nothing.
    async function warnings(body: () => void | Promise<void>): Promise<string> {
        const captured: string[] = []
        const previousDebug = Bun.env.DEBUG
        const previousWarn = console.warn
        const previousWrite = process.stderr.write
        Bun.env.DEBUG = 'abide:cli'
        console.warn = (...args: unknown[]): void => void captured.push(args.map(String).join(' '))
        process.stderr.write = ((chunk: unknown): boolean => {
            captured.push(String(chunk))
            return true
        }) as typeof process.stderr.write
        try {
            await body()
        } finally {
            console.warn = previousWarn
            process.stderr.write = previousWrite
            if (previousDebug === undefined) delete Bun.env.DEBUG
            else Bun.env.DEBUG = previousDebug
        }
        return captured.join('\n')
    }

    test('the dispatcher and the REPL classify through the same list', () => {
        const entries = Object.entries(RESERVED_CLI_COMMANDS) as [
            ReservedCliCommand,
            { where: 'both' | 'prompt' },
        ][]
        for (const [name, entry] of entries) {
            // The prompt sees every reserved name.
            expect(reservedCliCommand(name, 'prompt')).toBe(name)
            // The command line sees the ones that mean something there. `exit`/`quit` end a SESSION,
            // so on a command line they fall through to the app's own rpcs.
            expect(reservedCliCommand(name, 'command')).toBe(
                entry.where === 'prompt' ? undefined : name,
            )
        }
        expect(reservedCliCommand('greet', 'command')).toBeUndefined()
        expect(reservedCliCommand('greet', 'prompt')).toBeUndefined()
        expect(reservedCliCommand(undefined, 'command')).toBeUndefined()
    })

    test('the generated help lists every reserved name', () => {
        const help = cliUsage('demo', [])
        for (const name of RESERVED) expect(help).toContain(name)
        // Each is listed with the table's own description, so help cannot describe a name differently
        // from the list that reserves it.
        for (const entry of Object.values(RESERVED_CLI_COMMANDS))
            expect(help).toContain(entry.description)
    })

    test('the shadow warning fires for every reserved name — including the prompt-only ones', async () => {
        const routes: Record<string, Route> = {}
        for (const name of RESERVED) routes[name] = GET(() => ({ ok: true }))
        routes.greet = GET(() => ({ ok: true }))

        const captured = await warnings(() => void cliCommands({ routes }))
        for (const name of RESERVED) expect(captured).toContain(`rpc "${name}" is shadowed`)
        // `exit` was reserved by the REPL but missing from the list, so an rpc named `exit` was
        // unreachable at the prompt with nothing said about it.
        expect(captured).toContain('cannot be called from the interactive prompt')
        expect(captured).not.toContain('rpc "greet"')
    })

    test('the REPL really intercepts them — `help` then `exit` never touches the app', async () => {
        // `origin()` is what boots the embedded app; a session that only asks for help must not.
        const target: CommandTarget = {
            origin: (): Promise<string> => Promise.reject(new Error('must not boot')),
            host: (): Promise<string> => Promise.resolve('http://localhost:0'),
            hosting: (): undefined => undefined,
            remote: (): undefined => undefined,
            retarget: (): void => {},
            stop: (): Promise<void> => Promise.resolve(),
        }
        const out: string[] = []
        const code = await interactiveCli({
            name: 'demo',
            commands: [],
            target,
            flags: {},
            pretty: false,
            tty: false,
            input: new Response('help\nexit\n').body as ReadableStream<Uint8Array>,
            write: (text) => out.push(text),
            writeError: (text) => out.push(text),
        })
        expect(code).toBe(0)
        expect(out.join('')).toContain('Reserved:')
    })
})
