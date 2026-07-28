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
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { callCliCommand } from './callCliCommand.ts'
import { type CliCommand, cliCommands } from './cliCommands.ts'
import { cliUsage } from './cliUsage.ts'
import { type CommandTarget, commandTarget } from './commandTarget.ts'
import { type CompiledApp, compiledAppConfig } from './compiledAppConfig.ts'
import { completeCliLine } from './completeCliLine.ts'
import { COMPLETION_SHELLS, type CompletionShell, completionScript } from './completionScript.ts'
import { connectCommand } from './connectCommand.ts'
import { disconnectCommand } from './disconnectCommand.ts'
import { identityCommand } from './identityCommand.ts'
import { interactiveCli } from './interactiveCli.ts'
import { loginCommand } from './loginCommand.ts'
import { logoutCommand } from './logoutCommand.ts'
import { logsCommand } from './logsCommand.ts'
import { normalizeOrigin } from './normalizeOrigin.ts'
import { parseCliArgs } from './parseCliArgs.ts'
import { reservedCliCommand } from './reservedCliCommand.ts'
import { resolveCliTarget } from './resolveCliTarget.ts'
import { serveCompiled } from './serveCompiled.ts'

interface GlobalOptions {
    url?: string
    token?: string
    pretty: boolean
    help: boolean
    // argv from the subcommand onward.
    rest: string[]
}

function write(text: string): void {
    process.stdout.write(text)
}

function writeError(text: string): void {
    process.stderr.write(text)
}

function parseGlobals(argv: string[]): GlobalOptions {
    // Pretty on a terminal, compact through a pipe — the same TTY-shaped default the log format uses,
    // for the same reason: one output is read by a person, the other by `jq`.
    const options: GlobalOptions = { pretty: process.stdout.isTTY === true, help: false, rest: [] }
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

export async function runCompiledApp(app: CompiledApp): Promise<void> {
    const globals = parseGlobals(Bun.argv.slice(2))
    const config = compiledAppConfig(app)
    const commands = cliCommands(config)
    const byName = new Map<string, CliCommand>()
    for (const command of commands) byName.set(command.name, command)

    const head = globals.rest[0]
    // Branch on the ONE reserved list rather than on literals — see `RESERVED_CLI_COMMANDS`. A
    // prompt-only name (`exit`) classifies as undefined here and falls through to the rpc table.
    const reserved = reservedCliCommand(head, 'command')

    // `--help` reaches the same text from either side of the subcommand (`app --help greet` and
    // `app greet --help`), so asking for help never accidentally RUNS the command it asked about.
    if (globals.help) {
        write(
            `${cliUsage(app.name, commands, head === undefined ? undefined : byName.get(head))}\n`,
        )
        return
    }

    // `completion` wears two hats, and deliberately: `--line` is the CALLBACK the generated script
    // invokes on every TAB, so keeping it here rather than under a second reserved name costs the app
    // one shadowed rpc name instead of two. Both exit before anything boots — completing a command
    // must never run the app's `onStart`.
    if (reserved === 'completion') {
        const lineFlag = globals.rest.indexOf('--line')
        if (lineFlag !== -1) {
            const { candidates } = completeCliLine({
                line: globals.rest[lineFlag + 1] ?? '',
                commands,
                surface: 'command',
            })
            if (candidates.length > 0) write(`${candidates.join('\n')}\n`)
            return
        }
        const requested = globals.rest[1]
        const shell = COMPLETION_SHELLS.includes(requested as CompletionShell)
            ? (requested as CompletionShell)
            : undefined
        if (shell === undefined) {
            writeError(
                `${app.name} completion — usage: ${app.name} completion <${COMPLETION_SHELLS.join('|')}>\n`,
            )
            process.exitCode = CLI_EXIT_CODES.usage
            return
        }
        write(completionScript(shell, app.name))
        return
    }

    if (reserved === 'help') {
        const target = globals.rest[1] === undefined ? undefined : byName.get(globals.rest[1])
        write(`${cliUsage(app.name, commands, target)}\n`)
        return
    }

    // Re-pointing the binary, or changing who it is, touches a file and nothing else — never the app.
    if (reserved === 'connect') {
        process.exit(
            await connectCommand({
                appName: app.name,
                argv: globals.rest.slice(1),
                write,
                writeError,
            }),
        )
    }
    if (reserved === 'disconnect') {
        process.exit(await disconnectCommand({ appName: app.name, write }))
    }
    if (reserved === 'login' || reserved === 'logout') {
        const resolvedFor = await resolveCliTarget({
            appName: app.name,
            url: globals.url,
            token: globals.token,
        })
        process.exit(
            reserved === 'login'
                ? await loginCommand({
                      appName: app.name,
                      origin: resolvedFor.remote,
                      argv: globals.rest.slice(1),
                      write,
                      writeError,
                  })
                : await logoutCommand({
                      appName: app.name,
                      origin: resolvedFor.remote,
                      write,
                      writeError,
                  }),
        )
    }

    // Host it. Long-lived: this branch must NOT exit when the function returns, and it goes through
    // `serveCompiled` so the foreground server is the same one `abide start` runs — port resolution,
    // lifecycle wrappers, warm pages and shutdown handling included.
    if (reserved === 'serve') {
        await serveCompiled(app, config, write)
        return
    }

    const resolved = await resolveCliTarget({
        appName: app.name,
        url: globals.url,
        token: globals.token,
    })
    const target = commandTarget({ app, config, remote: resolved.remote })
    // One registration for the whole process: a ctrl-c mid-command still runs the app's onStop
    // teardown, whether or not anything is bound yet.
    installShutdownHandlers({ url: '', stop: () => target.stop() })

    let code: number = CLI_EXIT_CODES.ok
    try {
        if (reserved === 'identity') {
            code = await identityCommand({
                origin: await target.origin(),
                token: resolved.token,
                pretty: globals.pretty,
                write,
                writeError,
            })
        } else if (reserved === 'logs') {
            // `target.origin()` boots the embedded server when nothing is connected, so a bare `logs`
            // tails THIS binary's own app — which is a real (if quiet) thing to do, and keeps the
            // command meaning one thing whether or not a deployment is named.
            code = await logsCommand({
                origin: await target.origin(),
                token: resolved.token,
                argv: globals.rest.slice(1),
                write,
                writeError,
            })
        } else if (head === undefined) {
            code = await interactiveCli({
                name: app.name,
                commands,
                target,
                token: resolved.token,
                flags: { url: globals.url, token: globals.token },
                pretty: globals.pretty,
                tty: process.stdin.isTTY === true,
                input: Bun.stdin.stream(),
                write,
                writeError,
            })
        } else {
            code = await runOnce({
                head,
                globals,
                byName,
                name: app.name,
                commands,
                target,
                token: resolved.token,
            })
        }
    } finally {
        await target.stop()
    }

    // Exit explicitly: a one-shot command must not linger because the app opened a handle in onStart.
    process.exit(code)
}

async function runOnce(input: {
    head: string
    globals: GlobalOptions
    byName: Map<string, CliCommand>
    name: string
    commands: CliCommand[]
    target: CommandTarget
    token: string | undefined
}): Promise<number> {
    const command = input.byName.get(input.head)
    if (command === undefined) {
        writeError(`${input.name}: unknown command "${input.head}"\n\n`)
        writeError(`${cliUsage(input.name, input.commands)}\n`)
        return CLI_EXIT_CODES.usage
    }

    const commandArgv = input.globals.rest.slice(1)
    if (commandArgv.includes('--help') || commandArgv.includes('-h')) {
        write(`${cliUsage(input.name, input.commands, command)}\n`)
        return CLI_EXIT_CODES.ok
    }

    const parsed = parseCliArgs(command, commandArgv)
    if (parsed.errors.length > 0) {
        for (const message of parsed.errors) writeError(`${input.name}: ${message}\n`)
        writeError(`\n${cliUsage(input.name, input.commands, command)}\n`)
        return CLI_EXIT_CODES.usage
    }

    return await callCliCommand({
        // Resolved here, after the command line is known to be good: a usage error never boots the app.
        origin: await input.target.origin(),
        token: input.token,
        command,
        args: parsed.args,
        pretty: input.globals.pretty,
        write,
        writeError,
    })
}
