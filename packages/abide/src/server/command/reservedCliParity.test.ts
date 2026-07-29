// The two surfaces of one command table, asserted against EACH OTHER.
//
// A compiled binary answers reserved commands from two entry points — `runCompiledApp` (argv) and
// `interactiveCli` (the prompt) — and each used to hand-write its own ladder over the same ten names.
// Nine were the same call twice, so the ladders drifted where the tenth was: `completion`, declared
// `where: 'both'`, listed under `Reserved:` in the generated help and warned about as shadowing an
// author's rpc, answered `unknown command "completion"` at the prompt. An app that DID export a
// `completion` rpc had it silently win there — the exact inversion the reserved list exists to prevent.
//
// The compile-time half of the fix is `reservedCliDispatch` being total over `CommandSurfaceReserved`
// (add an entry to the table and it does not build until it is answered). This is the runtime half, and
// it is driven off the TABLE rather than a list written here — a name added there is asserted on both
// surfaces with no second edit, which is the property that failed.
//
// `--help` is the probe because it is the one input every reserved name accepts and none may act on:
// it proves the name was RECOGNISED (no `unknown command`) and, with a target that throws, that being
// recognised booted nothing.

import { describe, expect, test } from 'bun:test'
import type { CliCommand } from './cliCommands.ts'
import { cliUsage } from './cliUsage.ts'
import type { CommandTarget } from './commandTarget.ts'
import type { CompiledApp } from './compiledAppConfig.ts'
import { completeCliLine } from './completeCliLine.ts'
import { interactiveCli } from './interactiveCli.ts'
import { RESERVED_CLI_COMMANDS } from './RESERVED_CLI_COMMANDS.ts'
import { runCompiledApp } from './runCompiledApp.ts'

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

// Every name that means something on BOTH surfaces — read off the table, never restated.
const ON_BOTH = Object.entries(RESERVED_CLI_COMMANDS)
    .filter(([, entry]) => entry.where === 'both')
    .map(([name]) => name)

// The prompt-only half, for the symmetric assertion: these must end the session rather than reach the
// shared dispatcher, and must NOT be reachable as subcommands.
const PROMPT_ONLY = Object.entries(RESERVED_CLI_COMMANDS)
    .filter(([, entry]) => entry.where === 'prompt')
    .map(([name]) => name)

// `origin()` and `host()` both reject: reaching either means a name that should have answered off the
// command table booted or bound something instead.
const INERT_TARGET: CommandTarget = {
    origin: (): Promise<string> => Promise.reject(new Error('must not boot')),
    host: (): Promise<string> => Promise.reject(new Error('must not bind')),
    hosting: (): undefined => undefined,
    remote: (): undefined => undefined,
    retarget: (): void => {},
    stop: (): Promise<void> => Promise.resolve(),
}

async function atPrompt(line: string): Promise<string> {
    const out: string[] = []
    await interactiveCli({
        name: 'demoapp',
        commands: [] as CliCommand[],
        target: INERT_TARGET,
        flags: {},
        pretty: false,
        tty: false,
        input: new Response(`${line}\nexit\n`).body as ReadableStream<Uint8Array>,
        write: (text) => out.push(text),
        writeError: (text) => out.push(text),
    })
    return out.join('')
}

async function onCommandLine(argv: string[]): Promise<{ code: number | null; text: string }> {
    const out: string[] = []
    const code = await runCompiledApp(APP, {
        argv,
        write: (text) => out.push(text),
        writeError: (text) => out.push(text),
        stdoutIsTty: false,
        stdinIsTty: false,
    })
    return { code, text: out.join('') }
}

describe('every `where: both` reserved name is answered on BOTH surfaces', () => {
    test.each(ON_BOTH.map((name) => [name]))('`%s --help` on the command line', async (name) => {
        const { code, text } = await onCommandLine([name, '--help'])
        expect(text).not.toContain('unknown command')
        // A code, not `null`: `null` is the long-lived serve branch, so it would mean `serve --help`
        // started the server rather than describing it.
        expect(code).toBe(0)
        expect(text).toContain('demoapp')
    })

    test.each(ON_BOTH.map((name) => [name]))('`%s --help` at the prompt', async (name) => {
        const text = await atPrompt(`${name} --help`)
        expect(text).not.toContain('unknown command')
        expect(text).toContain('demoapp')
    })

    // The specific regression. `completion` is the name the two ladders disagreed about, and unlike the
    // `--help` probe above this asserts it does its actual JOB at the prompt — the TAB callback the
    // generated shell script delegates to on every keystroke.
    test('`completion --line` answers candidates at the prompt, not `unknown command`', async () => {
        const text = await atPrompt('completion --line hel')
        expect(text).not.toContain('unknown command')
        expect(text).toContain('help')
    })

    test('`completion bash` emits the script at the prompt too', async () => {
        expect(await atPrompt('completion bash')).toContain('complete -o default')
    })
})

describe('the prompt-only names stay prompt-only', () => {
    test.each(PROMPT_ONLY.map((name) => [name]))('`%s` ends the session', async (name) => {
        // Nothing after it runs: the trailing `exit` the harness appends is never read, and a name that
        // fell through to the shared dispatcher instead would have said `unknown command`.
        expect(await atPrompt(name)).not.toContain('unknown command')
    })

    // On a command line there is no session to leave, so the name belongs to the app's rpcs. With none
    // declared here that is an unknown command — which is the point: it is NOT intercepted.
    test.each(PROMPT_ONLY.map((name) => [name]))('`%s` is not a subcommand', async (name) => {
        const { code, text } = await onCommandLine([name])
        expect(text).toContain('unknown command')
        expect(code).toBe(2)
    })
})

// THE FLAGS, NOT JUST THE NAMES.
//
// `cliUsage` and `completeCliLine` both open by declaring flag drift impossible, and both are right
// about the APP's commands — those project from `cliCommands`, so a handler that gains a field gains a
// flag in help and at the prompt with no second edit. Neither was true of the reserved half of the
// same surface: the flags lived in `description` prose, so `logs` advertised five while its parser
// accepted eight, and completion hardcoded a list for `serve` and `login` and offered nothing for the
// rest — including `logs`, which has more flags than any other command on either surface.
//
// Driven off the TABLE, so a flag added there is asserted on both projections with no second edit.
describe("a reserved command's flags reach both projections", () => {
    const WITH_FLAGS: [string, readonly string[]][] = []
    for (const [name, entry] of Object.entries(RESERVED_CLI_COMMANDS)) {
        if ('flags' in entry) WITH_FLAGS.push([name, entry.flags])
    }

    test('every declared flag appears in the generated help', () => {
        const help = cliUsage('demoapp', [])
        for (const [name, flags] of WITH_FLAGS) {
            for (const flag of flags) {
                expect(`${name}:${help}`).toContain(flag)
            }
        }
    })

    test('every declared flag is offered at the prompt', () => {
        for (const [name, flags] of WITH_FLAGS) {
            // An empty partial, so the single-dash aliases are in scope too — typing `--` filters them
            // out, which is the completer working, not a gap.
            const { candidates } = completeCliLine({
                line: `${name} `,
                commands: [],
                surface: 'command',
            })
            expect([name, [...candidates].sort()]).toEqual([name, [...flags].sort()])
        }
    })

    // The three spellings the `logs` parser accepts that its prose never mentioned.
    test('the `logs` aliases the parser accepts are among them', () => {
        const flags = RESERVED_CLI_COMMANDS.logs.flags as readonly string[]
        for (const alias of ['-f', '-n', '--channel']) expect(flags).toContain(alias)
    })
})
