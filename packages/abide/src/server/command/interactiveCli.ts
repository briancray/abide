// interactiveCli(options) — what a compiled binary does when you just run it (MS3.1): a schema-driven
// command REPL over whichever target is active (the embedded app or a `--url` deployment).
//
// It is the same dispatch the one-shot path uses, wrapped in a read loop — a line with flags is parsed
// by `parseCliArgs` exactly as a command line is, and a bare command name is FILLED IN by prompting for
// each field the input schema declares. That is the whole idea: the app already describes its inputs,
// so an interactive caller should never have to know the flag spelling.
//
// `serve` from the prompt binds the embedded app on a real port and leaves it running, so the session
// can go on calling commands against it — the interactive route to the same place `serve` reaches.
// `connect`/`disconnect` are here for the same reason: re-pointing mid-session is the one thing you
// cannot do from a command line you have already run, and the stored target is re-READ afterwards
// rather than threaded through, so the file stays the single answer to "where do calls go".
//
// Input goes through `lineReader`, which is the terminal/pipe split: at a terminal you get line
// editing, history and a ctrl-c that abandons the line; through a pipe it is still newline-framed
// bytes, so `printf 'greet\n' | app` behaves exactly as it did. No completion yet.

import { flagValue } from '../../cli/flagValue.ts'
import { colourEnabled } from '../../shared/internal/colourEnabled.ts'
import { COERCE_FAILED, tryCoerceStringToType } from '../../shared/internal/jsonSchema.ts'
import { type Paint, painter } from '../../shared/internal/painter.ts'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { callCliCommand } from './callCliCommand.ts'
import type { CliCommand } from './cliCommands.ts'
import { cliUsage } from './cliUsage.ts'
import { columnise } from './columnise.ts'
import type { CommandTarget } from './commandTarget.ts'
import { completeCliLine } from './completeCliLine.ts'
import { type LineReader, lineReader } from './lineReader.ts'
import { parseCliArgs } from './parseCliArgs.ts'
import { RESERVED_CLI_COMMANDS } from './RESERVED_CLI_COMMANDS.ts'
import { reservedCliCommand } from './reservedCliCommand.ts'
import { reservedCliDispatch } from './reservedCliDispatch.ts'
import { type ResolvedCliTarget, resolveCliTarget } from './resolveCliTarget.ts'
import { tokenizeCliLine } from './tokenizeCliLine.ts'

export interface InteractiveCliOptions {
    name: string
    commands: CliCommand[]
    target: CommandTarget
    token?: string | undefined
    // The launch-time `--url`/`--token`, kept so a mid-session `connect`/`disconnect` re-resolves
    // through the SAME ladder it started with — a flag given on the command line must not be quietly
    // demoted by a later write to the stored target.
    flags: { url?: string | undefined; token?: string | undefined }
    pretty: boolean
    // Whether a person is typing. Only used to tell "someone ran this with no input at all" (a
    // container starting the binary with no arguments) from a deliberate piped session.
    tty: boolean
    input: ReadableStream<Uint8Array>
    write(text: string): void
    writeError(text: string): void
}

// Styling is opt-OUT by surface, not by flag: `colourEnabled` follows NO_COLOR / FORCE_COLOR / is-a-
// terminal, so a piped session (`printf 'greet\n' | app`) emits exactly the bytes it always did and
// nothing downstream has to strip escapes. The escapes themselves are `painter`, shared with the
// `abide <command>` banners so the two surfaces cannot dim to different greys.

// Prompt for one field, returning the typed value — or undefined when the caller pressed enter (an
// optional field left out entirely, which is not the same as sending null).
async function promptField(
    options: InteractiveCliOptions,
    reader: LineReader,
    paint: Paint,
    command: CliCommand,
    index: number,
): Promise<{ value: unknown } | undefined> {
    const field = command.fields[index]
    if (field === undefined) return undefined
    const type = field.type ?? 'value'
    const detail = field.required ? 'required' : 'optional'
    const hint = field.enum === undefined ? '' : ` ${field.enum.map(String).join('|')}`
    // The value you get by pressing enter, in the shell-prompt convention (`read -p "name [dflt]: "`,
    // `./configure`, `npm init`): parentheses say what the field IS, brackets say what you get for
    // free. Omitting the flag is what makes the handler's own default apply, so this is not a
    // decoration — it is the answer to "what happens if I just hit enter".
    const fallback = field.default === undefined ? '' : ` [${String(field.default)}]`
    // Not history: an answer to `title:` is a value, not a command, and recalling it at the next
    // prompt would offer it where a command name belongs.
    // The NAME carries the weight; the type/required/enum apparatus is dimmed so a column of field
    // prompts reads as a form rather than as five equally-loud lines.
    const label = `  ${field.name}${paint.dim(` (${type}, ${detail}${hint})${fallback}`)}: `
    const answer = await reader.read(label, {
        history: false,
        // The field's own closed set, when it has one — the same schema fact the `[a|b]` hint above
        // is printed from, offered as completion instead of only as prose.
        complete:
            field.enum === undefined
                ? undefined
                : (typed) => {
                      const values = field.enum ?? []
                      return {
                          candidates: values
                              .map(String)
                              .filter((value) => value.startsWith(typed))
                              .sort(),
                          partial: typed,
                      }
                  },
    })
    if (answer === undefined) return undefined
    const raw = answer.trim()
    if (raw === '') {
        if (field.required) options.writeError(`  ${field.name} is required — sending it empty.\n`)
        return field.required ? { value: '' } : undefined
    }
    const coerced = tryCoerceStringToType(raw, field.type)
    if (coerced === COERCE_FAILED) {
        options.writeError(`  ${field.name} expects ${type} — sending it as text.\n`)
        return { value: raw }
    }
    return { value: coerced }
}

// `serve [--port n]` from the prompt: bind the app on a real port and keep it there. `argv` is what
// followed the word, as every other reserved command receives it.
async function hostFromPrompt(options: InteractiveCliOptions, argv: string[]): Promise<number> {
    // Both spellings, through the one helper that knows them — a bare `indexOf('--port')` here read
    // `serve --port=9000` as no flag at all and bound 3000 in silence, in the same binary whose global
    // options and rpc flags both accept `=`.
    const raw = flagValue(argv, '--port')
    const port = raw === undefined ? undefined : Number(raw)
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        options.writeError(`serve: --port expects a port number — got "${raw}"\n`)
        return CLI_EXIT_CODES.usage
    }
    try {
        const url = await options.target.host(port)
        options.write(
            `serving ${url} — commands now run against it; \`exit\` (or ctrl-c at an empty prompt) stops it\n`,
        )
        return CLI_EXIT_CODES.ok
    } catch (caught) {
        options.writeError(`serve: ${caught instanceof Error ? caught.message : String(caught)}\n`)
        return CLI_EXIT_CODES.failed
    }
}

export async function interactiveCli(options: InteractiveCliOptions): Promise<number> {
    const byName = new Map<string, CliCommand>()
    for (const command of options.commands) byName.set(command.name, command)

    const paint = painter(colourEnabled(options.tty))
    // `|| 80`, not `?? 80`: a PTY that was never sized reports columns as 0 (expect, some CI
    // runners), and 0 is not a narrow terminal — it is no answer. `??` let it through and collapsed
    // the list to one name per line.
    const width = process.stdout.columns || 80

    options.write(`${paint.bold(options.name)} ${paint.dim('— interactive')}\n`)
    if (options.commands.length === 0) {
        options.write(
            paint.dim('This app exposes no clients.cli rpcs. `serve` hosts it; `exit` leaves.\n'),
        )
    } else {
        // Columns, not a comma-separated wall: 59 names on one line is the list without being
        // readable, and it pushed the line that says what to DO off a short terminal.
        for (const line of columnise(
            options.commands.map((command) => command.name),
            width,
        )) {
            options.write(`${line}\n`)
        }
        // Only advertise what this surface actually does: a pipe has no TAB and no cursor, and under
        // NO_COLOR there is no dimmed hint to accept. Naming a key that does nothing here is worse
        // than naming none.
        const coloured = colourEnabled(options.tty)
        const keys = [
            options.tty ? 'TAB completes' : undefined,
            options.tty && coloured ? '\u2192 accepts the hint' : undefined,
        ].filter((hint) => hint !== undefined)
        // Derived from the one table, the way `cliUsage` derives help from it. Spelled as prose here,
        // this was the FIFTH place that had to agree about the reserved names and the only one that did
        // not read them: the table declares eleven and the line named six, so `disconnect`, `login`,
        // `logout`, `completion` and `quit` were intercepted at this prompt and advertised nowhere.
        const reserved = Object.entries(RESERVED_CLI_COMMANDS)
            .map(([name, entry]) =>
                'args' in entry && entry.args !== undefined
                    ? `\`${name} ${entry.args}\``
                    : `\`${name}\``,
            )
            .join(', ')
        options.write(
            paint.dim(
                `\n${options.commands.length} commands${keys.length === 0 ? '' : ` · ${keys.join(', ')}`} · ${reserved}\n`,
            ),
        )
    }

    // Both are re-resolved after a `connect`/`disconnect`, so a session that re-points itself keeps
    // calling the right place with the right credential. Through the SAME ladder the session started
    // with — the launch-time `--url`/`--token` still outrank whatever was just written to the file.
    let token = options.token
    const reresolve = (): Promise<ResolvedCliTarget> =>
        resolveCliTarget({
            appName: options.name,
            url: options.flags.url,
            token: options.flags.token,
        })
    const reader = lineReader({
        input: options.input,
        tty: options.tty,
        write: options.write,
    })
    // The exit code of the LAST command run, so a piped script (`printf 'greet\n' | app`) still reports
    // failure. A session that runs nothing exits 0.
    let lastCode: number = CLI_EXIT_CODES.ok
    let sawInput = false

    for (;;) {
        const line = await reader.read(paint.prompt, {
            complete: (typed) =>
                completeCliLine({ line: typed, commands: options.commands, surface: 'prompt' }),
        })
        if (line === undefined) break
        sawInput = true
        const tokens = tokenizeCliLine(line.trim())
        const head = tokens[0]
        if (head === undefined) {
            continue
        }
        // The prompt intercepts the ONE reserved list (`RESERVED_CLI_COMMANDS`) — including the
        // prompt-only `exit`/`quit`, which is why they are in it: a name that ends the session shadows
        // an rpc of that name just as `serve` does, and the author deserves the same warning.
        const reserved = reservedCliCommand(head, 'prompt')
        // `--help`/`-h` typed bare is the same request as `help`; every other reserved name is answered
        // by the SHARED table below rather than by a second ladder here.
        if (head === '--help' || head === '-h') {
            const target = tokens[1] === undefined ? undefined : byName.get(tokens[1])
            options.write(`${cliUsage(options.name, options.commands, target)}\n`)
            continue
        }
        if (reserved !== undefined) {
            // The prompt-only half: loop control, not calls, which is exactly what `where: 'prompt'`
            // means. Narrowing on it leaves `reserved` as `CommandSurfaceReserved` for the dispatcher.
            if (reserved === 'exit' || reserved === 'quit') break
            lastCode =
                (await reservedCliDispatch(reserved, {
                    appName: options.name,
                    commands: options.commands,
                    surface: 'prompt',
                    argv: tokens.slice(1),
                    pretty: options.pretty,
                    write: options.write,
                    writeError: options.writeError,
                    origin: () => options.target.origin(),
                    remote: async () => options.target.remote(),
                    token: async () => token,
                    // At the prompt `serve` binds a real port and the session CARRIES ON against it,
                    // so this hands back a code where the subcommand hands back `null`.
                    serve: (argv) => hostFromPrompt(options, argv),
                    // A tail owns the terminal until it is stopped, so ctrl-c DETACHES the feed rather
                    // than leaving the session — the one command that needs its own interrupt.
                    interceptInterrupt: (onInterrupt) => reader.interceptInterrupt(onInterrupt),
                    afterTargetChange: async () => {
                        // Re-read rather than trusting what was just written: the flag and env rungs
                        // still outrank the stored file, so a launch-time `--url` keeps winning over a
                        // mid-session `connect`. That is the right precedence and the wrong thing to
                        // leave implicit — when the two disagree, say where calls actually go.
                        const at = await reresolve()
                        options.target.retarget(at.remote)
                        token = at.token
                        if (at.remote !== at.connected) {
                            options.write(
                                `note: calls go to ${at.remote ?? 'the app hosted here'} — --url / ABIDE_APP_URL outranks the stored target.\n`,
                            )
                        }
                    },
                    afterCredentialChange: async () => {
                        token = (await reresolve()).token
                    },
                })) ?? CLI_EXIT_CODES.ok
            continue
        }

        const command = byName.get(head)
        if (command === undefined) {
            options.writeError(
                `${paint.error(`unknown command "${head}"`)} — type \`help\` for the list.\n`,
            )
            lastCode = CLI_EXIT_CODES.usage
            continue
        }

        const commandArgv = tokens.slice(1)
        // `--help` REACHES THE SAME TEXT FROM EITHER SIDE OF THE SUBCOMMAND — the invariant
        // `reservedCliDispatch` states, which held for the reserved half and not for this one. The
        // one-shot path gates here before parsing (`runCompiledApp`), the REPL did not, so `greet --help`
        // at the prompt answered `unknown flag --help for greet` (or `--help needs a value`) and exited
        // `usage`, while `./app greet --help` printed the generated help.
        if (commandArgv.includes('--help') || commandArgv.includes('-h')) {
            options.write(`${cliUsage(options.name, options.commands, command)}\n`)
            lastCode = CLI_EXIT_CODES.ok
            continue
        }

        let args: Record<string, unknown> = {}
        if (commandArgv.length > 0) {
            const parsed = parseCliArgs(command, commandArgv)
            if (parsed.errors.length > 0) {
                for (const message of parsed.errors) options.writeError(`${paint.error(message)}\n`)
                lastCode = CLI_EXIT_CODES.usage
                continue
            }
            args = parsed.args
        } else {
            // Bare command name: fill it in from the schema. This is the interactive mode's whole point.
            for (let index = 0; index < command.fields.length; index++) {
                const field = command.fields[index]
                const answered = await promptField(options, reader, paint, command, index)
                if (answered !== undefined && field !== undefined) args[field.name] = answered.value
            }
        }

        lastCode = await callCliCommand({
            // Resolved per call: this is what boots the embedded app, so a session that only asks for
            // help never runs the app's onStart.
            origin: await options.target.origin(),
            token,
            command,
            args,
            pretty: options.pretty,
            write: options.write,
            writeError: options.writeError,
        })
    }
    reader.close()

    // Stdin closed without ever offering a line, and nobody is typing: this is a process started with
    // no arguments and no console — a container running the binary as its entrypoint. Interactive mode
    // would otherwise "succeed" instantly and exit 0, which reads to an orchestrator as a clean exit
    // and restart-loops in silence. Say what happened and fail.
    if (!sawInput && !options.tty) {
        options.writeError(
            `\n${options.name}: nothing to read on stdin and no command given.\n` +
                `Did you mean \`${options.name} serve\` (host the app) or \`${options.name} <command>\`?\n`,
        )
        return CLI_EXIT_CODES.usage
    }
    return lastCode
}
