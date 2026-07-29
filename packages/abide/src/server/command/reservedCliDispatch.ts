// reservedCliDispatch(reserved, context) — what a RESERVED command does, once, for both surfaces.
//
// A compiled binary has two entry points over one command table: `runCompiledApp` (one-shot, argv) and
// `interactiveCli` (the REPL prompt). They differ genuinely in session-ness, in ctrl-c handling and in
// what `serve` means — but that is three differences, and each surface had hand-written its own ladder
// over ALL TEN reserved names to express them. Nine of the ten were the same call twice.
//
// The cost was not the duplication, it was that `RESERVED_CLI_COMMANDS` could only half-enforce itself.
// A name a surface intercepts must be in the table (`reservedCliCommand` returns the table's keys), but
// nothing required the table's keys to be intercepted — so `completion`, declared `where: 'both'`,
// listed under `Reserved:` in the generated help and warned about as shadowing an author's rpc of that
// name, answered `unknown command "completion"` at the prompt. Reserved on paper, unreachable in fact,
// and an app that DID export a `completion` rpc had it silently win there — the exact inversion the
// list exists to prevent.
//
// So the switch below is TOTAL over `CommandSurfaceReserved` (the `where: 'both'` names, derived from
// the table) and ends in a `never` check. Adding an entry to `RESERVED_CLI_COMMANDS` now fails to
// compile until it is answered here, which answers it on both surfaces at once.
//
// The three real differences are CONTEXT, not branches: `serve` is a hook (foreground `serveCompiled`
// vs binding the session's own target), `interceptInterrupt` is absent on a command line that has no
// session to return to, and the `after*Change` hooks are where the prompt re-resolves what a command
// line simply exits after. `exit`/`quit` are not here at all: they are loop control rather than a call,
// which is what `where: 'prompt'` means, and the prompt's own switch is total over that half.

import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import type { CliCommand } from './cliCommands.ts'
import { cliUsage } from './cliUsage.ts'
import { completeCliLine } from './completeCliLine.ts'
import { COMPLETION_SHELLS, type CompletionShell, completionScript } from './completionScript.ts'
import { connectCommand } from './connectCommand.ts'
import { disconnectCommand } from './disconnectCommand.ts'
import { identityCommand } from './identityCommand.ts'
import { loginCommand } from './loginCommand.ts'
import { logoutCommand } from './logoutCommand.ts'
import { logsCommand } from './logsCommand.ts'
import type { CommandSurfaceReserved } from './RESERVED_CLI_COMMANDS.ts'

// `null` = this branch is LONG-LIVED and the process must stay alive on the server's handles. Only the
// command line's `serve` produces it; the prompt's `serve` hands back a code, because a session goes on
// after binding.
export type ReservedOutcome = number | null

export interface ReservedCliContext {
    appName: string
    // The app's own `clients.cli` commands, for `help` and for what `completion` offers.
    commands: CliCommand[]
    // Which surface is asking. Used only where the ANSWER differs, never to re-derive the dispatch.
    surface: 'command' | 'prompt'
    // Everything AFTER the reserved word.
    argv: string[]
    pretty: boolean
    write(text: string): void
    writeError(text: string): void

    // Where calls land and who they land as. All three are ACCESSORS, asked for only by the branch that
    // needs one, which is what keeps the contract both surfaces state: `help` and `completion` answer
    // off the command table alone, so asking for help resolves no stored target and runs no `onStart`.
    // Async because on a command line resolving the target reads a file; a prompt has already done it.
    origin(): Promise<string>
    remote(): Promise<string | undefined>
    // Asked per command rather than passed by value: a prompt session's credential changes under it
    // when `login` succeeds, and one captured at dispatch time would send the previous token for the
    // rest of the session.
    token(): Promise<string | undefined>

    // `serve`. The one command whose MEANING differs by surface: a subcommand hosts in the foreground
    // and never returns, a prompt binds a port and carries on taking commands.
    serve(argv: string[]): Promise<ReservedOutcome>
    // Ctrl-C that detaches the current command instead of ending the process. A command line has
    // nothing to return to, so it supplies none and `logs` there is interrupted by the signal itself.
    interceptInterrupt?(onInterrupt: () => void): () => void
    // Where the prompt re-resolves; a command line is about to exit and supplies neither.
    afterTargetChange?(): Promise<void>
    afterCredentialChange?(): Promise<void>
}

export async function reservedCliDispatch(
    reserved: CommandSurfaceReserved,
    context: ReservedCliContext,
): Promise<ReservedOutcome> {
    // A reserved command's own `--help`, checked ONCE for every name and both surfaces. Asking for help
    // must never RUN the thing asked about, and the worst instance of getting that wrong is the one this
    // guards: `serve --help` booting the deployment. The command line had grown a gate for it; the
    // prompt had not, so `serve --help` there bound a port. Neither surface can skip it now, because
    // neither owns it.
    if (context.argv.some((token) => token === '--help' || token === '-h')) {
        context.write(`${cliUsage(context.appName, context.commands)}\n`)
        return CLI_EXIT_CODES.ok
    }

    switch (reserved) {
        case 'help': {
            const named = context.argv[0]
            const target =
                named === undefined
                    ? undefined
                    : context.commands.find((command) => command.name === named)
            context.write(`${cliUsage(context.appName, context.commands, target)}\n`)
            return CLI_EXIT_CODES.ok
        }

        // Two hats, deliberately: `--line` is the CALLBACK the generated script invokes on every TAB, so
        // keeping it under this one reserved name costs the app one shadowed rpc name instead of two.
        // Both answers exit before anything boots — completing a command must never run `onStart`.
        case 'completion': {
            const lineFlag = context.argv.indexOf('--line')
            if (lineFlag !== -1) {
                const { candidates } = completeCliLine({
                    line: context.argv[lineFlag + 1] ?? '',
                    commands: context.commands,
                    surface: context.surface,
                })
                if (candidates.length > 0) context.write(`${candidates.join('\n')}\n`)
                return CLI_EXIT_CODES.ok
            }
            const requested = context.argv[0]
            const shell = COMPLETION_SHELLS.includes(requested as CompletionShell)
                ? (requested as CompletionShell)
                : undefined
            if (shell === undefined) {
                context.writeError(
                    `${context.appName} completion — usage: ${context.appName} completion <${COMPLETION_SHELLS.join('|')}>\n`,
                )
                return CLI_EXIT_CODES.usage
            }
            context.write(completionScript(shell, context.appName))
            return CLI_EXIT_CODES.ok
        }

        case 'serve':
            return await context.serve(context.argv)

        // Re-pointing the binary touches a file and nothing else — never the app.
        case 'connect': {
            const code = await connectCommand({
                appName: context.appName,
                argv: context.argv,
                write: context.write,
                writeError: context.writeError,
            })
            await context.afterTargetChange?.()
            return code
        }
        case 'disconnect': {
            const code = await disconnectCommand({
                appName: context.appName,
                write: context.write,
            })
            await context.afterTargetChange?.()
            return code
        }

        case 'login': {
            const code = await loginCommand({
                appName: context.appName,
                origin: await context.remote(),
                argv: context.argv,
                write: context.write,
                writeError: context.writeError,
            })
            await context.afterCredentialChange?.()
            return code
        }
        case 'logout': {
            const code = await logoutCommand({
                appName: context.appName,
                origin: await context.remote(),
                write: context.write,
                writeError: context.writeError,
            })
            await context.afterCredentialChange?.()
            return code
        }

        case 'identity':
            return await identityCommand({
                origin: await context.origin(),
                token: await context.token(),
                pretty: context.pretty,
                write: context.write,
                writeError: context.writeError,
            })

        // `origin()` boots the embedded server when nothing is connected, so a bare `logs` tails THIS
        // binary's own app — a real (if quiet) thing to do, and it keeps the command meaning one thing
        // whether or not a deployment is named.
        case 'logs': {
            // A tail owns the terminal until it is stopped, so where there IS a session to return to,
            // ctrl-c detaches the feed rather than ending it.
            const feed = new AbortController()
            const release = context.interceptInterrupt?.(() => {
                context.write('^C\n')
                feed.abort()
            })
            try {
                return await logsCommand({
                    origin: await context.origin(),
                    token: await context.token(),
                    argv: context.argv,
                    write: context.write,
                    writeError: context.writeError,
                    signal: release === undefined ? undefined : feed.signal,
                })
            } finally {
                release?.()
            }
        }

        default: {
            // Exhaustiveness over the table, and the whole point of this module: an entry added to
            // `RESERVED_CLI_COMMANDS` with `where: 'both'` fails to compile here until it is answered,
            // rather than being listed in help and reaching no branch on either surface.
            const unanswered: never = reserved
            throw new Error(
                `unanswered reserved command: ${String(unanswered)} — every \`where: 'both'\` entry of RESERVED_CLI_COMMANDS must be dispatched here`,
            )
        }
    }
}
