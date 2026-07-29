// runCompiledApp(app) — the entry point of EVERY compiled abide binary (BP1.6-1.7 + MS3).
//
// There is one binary and one runtime, built by `abide compile`. There is no separate CLI build: the
// whole command surface costs 16 KB in a 67 MB executable, and a server that cannot be asked a
// question is a strictly worse server.
//
// What you get depends only on how you RUN it:
//
//   ./app                      interactive, schema-driven REPL          (the default)
//   ./app <command> [flags]    one `clients.cli` rpc, JSON to stdout    (MS3.2-3.4)
//   ./app serve [--port n]     host the app in the foreground
//   ./app connect <url>        point it at a deployment until `disconnect` (also at the prompt)
//   ./app disconnect           forget that target and go back to hosting
//   ./app login --token <t>    remember WHO you are there · `logout` drops it · `identity` asks
//   ./app help [command]       generated help
//   `serve` at the prompt      host it from inside a session
//
// `serve` and `help` are RESERVED (`RESERVED_CLI_COMMANDS`) — see there for why they win over an app
// rpc of the same name.
//
// and on WHERE the call lands:
//
//   --url, else ABIDE_APP_URL, → that deployment. Nothing boots; the embedded app is still what
//   else a stored `connect`      supplies the command table, so flags and types are known offline.
//                                (the full ladder lives in `resolveCliTarget`.)
//   otherwise                  → the app hosts itself, LAZILY (`commandTarget`) — printing help or
//                                mistyping a command never runs `onStart`.
//
// Global options are read only BEFORE the subcommand (`app --url http://x greet --name y`). Everything
// after the subcommand belongs to it — otherwise an rpc with a `url` or `token` field could never be
// called, and which side of the collision won would depend on parse order.

import { installShutdownHandlers } from '../../cli/installShutdownHandlers.ts'
import { normalizeOrigin } from '../internal/normalizeOrigin.ts'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { callCliCommand } from './callCliCommand.ts'
import { type CliCommand, cliCommands } from './cliCommands.ts'
import { cliUsage } from './cliUsage.ts'
import { type CommandTarget, commandTarget } from './commandTarget.ts'
import { type CompiledApp, compiledAppConfig } from './compiledAppConfig.ts'
import { interactiveCli } from './interactiveCli.ts'
import { parseCliArgs } from './parseCliArgs.ts'
import { reservedCliCommand } from './reservedCliCommand.ts'
import { reservedCliDispatch } from './reservedCliDispatch.ts'
import { type ResolvedCliTarget, resolveCliTarget } from './resolveCliTarget.ts'
import { serveCompiled } from './serveCompiled.ts'

interface GlobalOptions {
    url?: string
    token?: string
    pretty: boolean
    help: boolean
    // argv from the subcommand onward.
    rest: string[]
}

// What a compiled binary reads and writes. Injectable for the same reason `interactiveCli`'s already
// is — so the dispatcher is callable from a test rather than only from a shell. It was NOT, and the
// asymmetry had no stated reason: the two halves of the same command surface, one fully testable and
// one reachable only by spawning a binary. The defaults reproduce the shell exactly, so the generated
// compile entry passes nothing.
export interface RunCompiledAppOptions {
    // argv from the SUBCOMMAND onward (i.e. already sliced past the executable + script).
    argv?: string[]
    write?: (text: string) => void
    writeError?: (text: string) => void
    // Is a person typing? Drives the pretty/compact output default and whether a bare run opens the REPL.
    stdinIsTty?: boolean
    stdoutIsTty?: boolean
    input?: ReadableStream<Uint8Array>
}

function parseGlobals(argv: string[], stdoutIsTty: boolean): GlobalOptions {
    // Pretty on a terminal, compact through a pipe — the same TTY-shaped default the log format uses,
    // for the same reason: one output is read by a person, the other by `jq`.
    const options: GlobalOptions = { pretty: stdoutIsTty, help: false, rest: [] }
    let index = 0
    for (; index < argv.length; index++) {
        const token = argv[index]
        if (token === undefined) break
        if (token === '--url' || token === '--token') {
            const value = argv[++index]
            if (value === undefined) break
            if (token === '--url') options.url = normalizeOrigin(value)
            else options.token = value
            continue
        }
        if (token.startsWith('--url=')) {
            options.url = normalizeOrigin(token.slice(6))
            continue
        }
        if (token.startsWith('--token=')) {
            options.token = token.slice(8)
            continue
        }
        if (token === '--pretty') {
            options.pretty = true
            continue
        }
        if (token === '--compact') {
            options.pretty = false
            continue
        }
        if (token === '--help' || token === '-h') {
            options.help = true
            continue
        }
        break // the subcommand (or something the subcommand owns)
    }
    options.rest = argv.slice(index)
    return options
}

// Returns the exit code the process should use, or `null` when this branch is LONG-LIVED (`serve`) and
// the process must stay alive on the server's handles. Returning rather than calling `process.exit`
// four times is what makes the dispatch testable in-process; the generated compile entry is the one
// place that turns a code into an exit.
export async function runCompiledApp(
    app: CompiledApp,
    options: RunCompiledAppOptions = {},
): Promise<number | null> {
    const write = options.write ?? ((text: string) => void process.stdout.write(text))
    const writeError = options.writeError ?? ((text: string) => void process.stderr.write(text))
    const stdoutIsTty = options.stdoutIsTty ?? process.stdout.isTTY === true
    const globals = parseGlobals(options.argv ?? Bun.argv.slice(2), stdoutIsTty)
    const config = compiledAppConfig(app)
    const commands = cliCommands(config)
    const byName = new Map<string, CliCommand>()
    for (const command of commands) byName.set(command.name, command)

    const head = globals.rest[0]
    // Classify against the ONE reserved list rather than on literals — see `RESERVED_CLI_COMMANDS`. A
    // prompt-only name (`exit`) classifies as undefined here and falls through to the rpc table, and
    // the `'command'` overload says so in the TYPE, so nothing below has an `exit` branch to get wrong.
    const reserved = reservedCliCommand(head, 'command')

    // `--help` reaches the same text from either side of the subcommand (`app --help greet` and
    // `app greet --help`), so asking for help never accidentally RUNS the command it asked about.
    // `parseGlobals` deliberately stops reading globals at the subcommand (so an rpc may own
    // `--url`/`--token`), so the other side is re-checked per branch: `runOnce` for an rpc, and
    // `reservedCliDispatch` for a reserved name — there, rather than here, because the prompt needs the
    // identical gate and used to lack it.
    if (globals.help) {
        write(
            `${cliUsage(app.name, commands, head === undefined ? undefined : byName.get(head))}\n`,
        )
        return CLI_EXIT_CODES.ok
    }

    // Where calls land, resolved AT MOST ONCE and only when something asks. `help` and `completion`
    // answer off the command table alone, so neither reads the stored target nor builds a `CommandTarget`
    // — and `CommandTarget` boots the embedded app only inside `origin()`, so even the branches that do
    // build one run no `onStart` until they need a server.
    let resolving: Promise<ResolvedCliTarget> | undefined
    const resolved = (): Promise<ResolvedCliTarget> =>
        (resolving ??= resolveCliTarget({
            appName: app.name,
            url: globals.url,
            token: globals.token,
        }))

    let target: CommandTarget | undefined
    const ensureTarget = async (): Promise<CommandTarget> => {
        if (target !== undefined) return target
        const at = await resolved()
        const built = commandTarget({ app, config, remote: at.remote })
        target = built
        // One registration for the whole process: a ctrl-c mid-command still runs the app's onStop
        // teardown, whether or not anything is bound yet.
        installShutdownHandlers({ url: '', stop: () => built.stop() })
        return built
    }

    let code: number | null = CLI_EXIT_CODES.ok
    try {
        if (reserved !== undefined) {
            // ONE dispatch table, shared with the REPL (`reservedCliDispatch`). What differs by surface
            // is supplied here rather than restated as a second ladder: `serve` hosts in the FOREGROUND
            // and never returns, there is no session to detach a `logs` tail back to, and nothing needs
            // re-resolving after `connect`/`login` because the process is about to exit.
            code = await reservedCliDispatch(reserved, {
                appName: app.name,
                commands,
                surface: 'command',
                argv: globals.rest.slice(1),
                pretty: globals.pretty,
                write,
                writeError,
                origin: async () => await (await ensureTarget()).origin(),
                remote: async () => (await resolved()).remote,
                token: async () => (await resolved()).token,
                serve: async () => {
                    // Through `serveCompiled` so the foreground server is the same one `abide start`
                    // runs — port resolution, lifecycle wrappers, warm pages and shutdown handling
                    // included. NULL, not a code: this branch is long-lived and the process must stay
                    // alive on the server's handles.
                    await serveCompiled(app, config, write, globals.rest.slice(1))
                    return null
                },
            })
        } else if (head === undefined) {
            const at = await resolved()
            code = await interactiveCli({
                name: app.name,
                commands,
                target: await ensureTarget(),
                token: at.token,
                flags: { url: globals.url, token: globals.token },
                pretty: globals.pretty,
                tty: options.stdinIsTty ?? process.stdin.isTTY === true,
                input: options.input ?? Bun.stdin.stream(),
                write,
                writeError,
            })
        } else {
            code = await runOnce({
                head,
                globals,
                byName,
                name: app.name,
                write,
                writeError,
                commands,
                ensureTarget,
                token: async () => (await resolved()).token,
            })
        }
    } finally {
        // `?.` because the text-only branches never built one — and building a target here purely to
        // stop it would boot nothing but would read the stored file after the answer was already given.
        await target?.stop()
    }

    // A one-shot command must not linger because the app opened a handle in `onStart`; the caller
    // turns this code into the process exit.
    return code
}

async function runOnce(input: {
    head: string
    globals: GlobalOptions
    byName: Map<string, CliCommand>
    name: string
    write: (text: string) => void
    writeError: (text: string) => void
    commands: CliCommand[]
    // Both deferred: an unknown command and a usage error answer without resolving a target or booting.
    ensureTarget: () => Promise<CommandTarget>
    token: () => Promise<string | undefined>
}): Promise<number> {
    const command = input.byName.get(input.head)
    if (command === undefined) {
        input.writeError(`${input.name}: unknown command "${input.head}"\n\n`)
        input.writeError(`${cliUsage(input.name, input.commands)}\n`)
        return CLI_EXIT_CODES.usage
    }

    const commandArgv = input.globals.rest.slice(1)
    if (commandArgv.includes('--help') || commandArgv.includes('-h')) {
        input.write(`${cliUsage(input.name, input.commands, command)}\n`)
        return CLI_EXIT_CODES.ok
    }

    const parsed = parseCliArgs(command, commandArgv)
    if (parsed.errors.length > 0) {
        for (const message of parsed.errors) input.writeError(`${input.name}: ${message}\n`)
        input.writeError(`\n${cliUsage(input.name, input.commands, command)}\n`)
        return CLI_EXIT_CODES.usage
    }

    return await callCliCommand({
        // Resolved here, after the command line is known to be good: a usage error never boots the app.
        origin: await (await input.ensureTarget()).origin(),
        token: await input.token(),
        command,
        args: parsed.args,
        pretty: input.globals.pretty,
        write: input.write,
        writeError: input.writeError,
    })
}
