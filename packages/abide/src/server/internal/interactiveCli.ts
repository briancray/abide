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
// Deliberately unpolished (MS3's parked item is the UX, not the model): no history, no completion, no
// line editing. It reads lines, so it behaves the same piped as at a terminal.

import { COERCE_FAILED, tryCoerceStringToType } from '../../shared/internal/jsonSchema.ts'
import { CLI_EXIT_CODES } from './CLI_EXIT_CODES.ts'
import { callCliCommand } from './callCliCommand.ts'
import type { CliCommand } from './cliCommands.ts'
import { cliUsage } from './cliUsage.ts'
import type { CommandTarget } from './commandTarget.ts'
import { connectCommand } from './connectCommand.ts'
import { disconnectCommand } from './disconnectCommand.ts'
import { identityCommand } from './identityCommand.ts'
import { loginCommand } from './loginCommand.ts'
import { logoutCommand } from './logoutCommand.ts'
import { parseCliArgs } from './parseCliArgs.ts'
import { resolveCliTarget } from './resolveCliTarget.ts'

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

const PROMPT = '> '

// Split a REPL line into argv, honouring quotes so a value with spaces survives (`--name "New York"`).
// Backslash escaping is deliberately absent — this is a prompt, not a shell.
function tokenize(line: string): string[] {
    const tokens: string[] = []
    let current = ''
    let quote: string | undefined
    let started = false
    for (const character of line) {
        if (quote !== undefined) {
            if (character === quote) quote = undefined
            else current += character
            continue
        }
        if (character === '"' || character === "'") {
            quote = character
            started = true
            continue
        }
        if (character === ' ' || character === '\t') {
            if (started) tokens.push(current)
            current = ''
            started = false
            continue
        }
        current += character
        started = true
    }
    if (started) tokens.push(current)
    return tokens
}

// Read newline-framed lines off a byte stream. Bun's `prompt()` would be shorter, but it blocks the
// event loop — and this process may also be hosting the server the next call goes to.
async function* readLines(input: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder()
    let buffered = ''
    for await (const chunk of input as unknown as AsyncIterable<Uint8Array>) {
        buffered += decoder.decode(chunk, { stream: true })
        let newline = buffered.indexOf('\n')
        while (newline !== -1) {
            yield buffered.slice(0, newline)
            buffered = buffered.slice(newline + 1)
            newline = buffered.indexOf('\n')
        }
    }
    buffered += decoder.decode()
    if (buffered.length > 0) yield buffered
}

// Prompt for one field, returning the typed value — or undefined when the caller pressed enter (an
// optional field left out entirely, which is not the same as sending null).
async function promptField(
    options: InteractiveCliOptions,
    lines: AsyncGenerator<string>,
    command: CliCommand,
    index: number,
): Promise<{ value: unknown } | undefined> {
    const field = command.fields[index]
    if (field === undefined) return undefined
    const type = field.type ?? 'value'
    const detail = field.required ? 'required' : 'optional'
    const hint = field.enum === undefined ? '' : ` [${field.enum.map(String).join('|')}]`
    options.write(`  ${field.name} (${type}, ${detail})${hint}: `)
    const next = await lines.next()
    if (next.done === true) return undefined
    const raw = next.value.trim()
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

// `serve [--port n]` from the prompt: bind the app on a real port and keep it there.
async function hostFromPrompt(options: InteractiveCliOptions, tokens: string[]): Promise<number> {
    const flagIndex = tokens.indexOf('--port')
    const raw = flagIndex === -1 ? undefined : tokens[flagIndex + 1]
    const port = raw === undefined ? undefined : Number(raw)
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        options.writeError(`serve: --port expects a port number — got "${raw}"\n`)
        return CLI_EXIT_CODES.usage
    }
    try {
        const url = await options.target.host(port)
        options.write(`serving ${url} — commands now run against it; ctrl-c or \`exit\` stops it\n`)
        return CLI_EXIT_CODES.ok
    } catch (caught) {
        options.writeError(`serve: ${caught instanceof Error ? caught.message : String(caught)}\n`)
        return CLI_EXIT_CODES.failed
    }
}

export async function interactiveCli(options: InteractiveCliOptions): Promise<number> {
    const byName = new Map<string, CliCommand>()
    for (const command of options.commands) byName.set(command.name, command)

    options.write(`${options.name} — interactive\n`)
    options.write(
        options.commands.length === 0
            ? 'This app exposes no clients.cli rpcs. `serve` hosts it; `exit` leaves.\n'
            : `Commands: ${options.commands.map((command) => command.name).join(', ')}\n` +
                  'Type a command (with or without flags), `serve`, `connect <url>`, `identity`, `help`, or `exit`.\n',
    )

    // Both are re-resolved after a `connect`/`disconnect`, so a session that re-points itself keeps
    // calling the right place with the right credential.
    let token = options.token
    const lines = readLines(options.input)
    // The exit code of the LAST command run, so a piped script (`printf 'greet\n' | app`) still reports
    // failure. A session that runs nothing exits 0.
    let lastCode: number = CLI_EXIT_CODES.ok
    let sawInput = false

    options.write(PROMPT)
    for await (const line of lines) {
        sawInput = true
        const tokens = tokenize(line.trim())
        const head = tokens[0]
        if (head === undefined) {
            options.write(PROMPT)
            continue
        }
        if (head === 'exit' || head === 'quit') return lastCode
        if (head === 'help' || head === '--help' || head === '-h') {
            const target = tokens[1] === undefined ? undefined : byName.get(tokens[1])
            options.write(`${cliUsage(options.name, options.commands, target)}\n`)
            options.write(PROMPT)
            continue
        }
        if (head === 'serve') {
            lastCode = await hostFromPrompt(options, tokens)
            options.write(PROMPT)
            continue
        }
        if (head === 'identity') {
            lastCode = await identityCommand({
                origin: await options.target.origin(),
                token,
                pretty: options.pretty,
                write: options.write,
                writeError: options.writeError,
            })
            options.write(PROMPT)
            continue
        }
        if (head === 'login' || head === 'logout') {
            const at = options.target.remote()
            lastCode =
                head === 'login'
                    ? await loginCommand({
                          appName: options.name,
                          origin: at,
                          argv: tokens.slice(1),
                          write: options.write,
                          writeError: options.writeError,
                      })
                    : await logoutCommand({
                          appName: options.name,
                          origin: at,
                          write: options.write,
                          writeError: options.writeError,
                      })
            token = (
                await resolveCliTarget({
                    appName: options.name,
                    url: options.flags.url,
                    token: options.flags.token,
                })
            ).token
            options.write(PROMPT)
            continue
        }
        if (head === 'connect' || head === 'disconnect') {
            lastCode =
                head === 'connect'
                    ? await connectCommand({
                          appName: options.name,
                          argv: tokens.slice(1),
                          write: options.write,
                          writeError: options.writeError,
                      })
                    : await disconnectCommand({ appName: options.name, write: options.write })
            // Re-read rather than trusting what was just written: the flag and env rungs still
            // outrank the stored file, so a launch-time `--url` keeps winning over a mid-session
            // `connect`. That is the right precedence and the wrong thing to leave implicit — when
            // the two disagree, say where calls actually go.
            const resolved = await resolveCliTarget({
                appName: options.name,
                url: options.flags.url,
                token: options.flags.token,
            })
            options.target.retarget(resolved.remote)
            token = resolved.token
            if (resolved.remote !== resolved.connected) {
                options.write(
                    `note: calls go to ${resolved.remote ?? 'the app hosted here'} — --url / ABIDE_APP_URL outranks the stored target.\n`,
                )
            }
            options.write(PROMPT)
            continue
        }

        const command = byName.get(head)
        if (command === undefined) {
            options.writeError(`unknown command "${head}" — type \`help\` for the list.\n`)
            lastCode = CLI_EXIT_CODES.usage
            options.write(PROMPT)
            continue
        }

        let args: Record<string, unknown> = {}
        if (tokens.length > 1) {
            const parsed = parseCliArgs(command, tokens.slice(1))
            if (parsed.errors.length > 0) {
                for (const message of parsed.errors) options.writeError(`${message}\n`)
                lastCode = CLI_EXIT_CODES.usage
                options.write(PROMPT)
                continue
            }
            args = parsed.args
        } else {
            // Bare command name: fill it in from the schema. This is the interactive mode's whole point.
            for (let index = 0; index < command.fields.length; index++) {
                const field = command.fields[index]
                const answered = await promptField(options, lines, command, index)
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
        options.write(PROMPT)
    }

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
