// 38.12 — THE COMMAND LINE, for both hosts that have one: `abide`, over an app on disk, and a
// compiled app's executable, over the app it holds (38.50). One list, so a command either has is a
// command both have — the executable answers the ones that need the source and the compiler with a
// refusal naming `abide`, rather than not knowing them.

import { resolve } from 'node:path' // bun exposes no path helpers of its own
import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet

import { MCP_ADDRESS, OPENAPI_ADDRESS } from '#shared/ADDRESSES.ts'
import { IN_PROCESS_ORIGIN } from '#shared/IN_PROCESS_ORIGIN.ts'

import { banner } from './banner.ts'
import { type App, type AppHandle, enterApp } from './createApp.ts'
import { stopOnSignalOrFault } from './faultPolicy.ts'
import {
    appUrl,
    callHandler,
    remoteHeaders,
    remoteUrl,
    watch as watchAddress,
} from './remote.ts'
import { inScope, LISTENING } from './requestScope.ts'
import { shell } from './shell.ts'
import { withoutTrailingSlash } from './withoutTrailingSlash.ts'

/** What a command is handed: the words after the flags, the command's own first, and the flags. */
export type Given = ReturnType<typeof parseFlags>

type Command = (given: Given) => Promise<number | undefined>

/** The commands that need the app's source and the compiler, which only `abide` holds. */
type SourceCommands = Record<
    | 'scaffold'
    | 'dev'
    | 'build'
    | 'check'
    | 'format'
    | 'routes'
    | 'compile'
    | 'bundle'
    | 'lsp',
    Command
>

/** Where the app a command means is — everything the two hosts differ in. */
export type Host = {
    /** What usage and every message speak as: `abide`, or the name the executable was run by. */
    name: string
    /** What `--version` prints: abide's own, or the compiled app's. 38.115. */
    version: string
    /**
     * The app the invocation means, found once off its flags (38.25): every command that serves,
     * boots, lists or announces it derives from this one handle.
     */
    app: (given: Given) => AppHandle
    source: SourceCommands | undefined
}

/**
 * Runs the command `argv` names; returns its exit code, or `undefined` where it took over.
 *
 * A COMMAND RETURNING NO CODE HAS TAKEN THE PROCESS OVER, and the caller must not exit on it —
 * doing so would close the socket `start` just bound, in the same tick it bound it.
 */
export async function runCommands(
    host: Host,
    argv: string[],
): Promise<number | undefined> {
    const commands = commandsOf(host)
    // 38.2 — EVERYTHING AFTER THE FILE IS THE SCRIPT'S, flags included, so `run` is taken before the
    // parser sees an argument it does not know.
    const given =
        argv[0] === 'run' ? { positionals: argv, values: {} } : parsed(argv)
    // 38.113 — a flag the parser refuses is one line and the usage, never the parser's stack.
    if (typeof given === 'string') {
        console.error(`${host.name}: ${given}\n\n${usage(host, commands)}`)
        return 1
    }
    const command = given.positionals[0]
    if (command === 'help' || given.values.help) {
        console.log(usage(host, commands))
        return 0
    }
    if (given.values.version) {
        console.log(host.version)
        return 0
    }
    if (command === undefined)
        return await shellOn(host, host.app(given), given)
    let nearest: string | undefined
    let nearestDistance = NEAREST_COMMAND_DISTANCE + 1
    for (const [name, , body] of commands) {
        const word = name.split(' ')[0] as string
        if (word === command) return await body(given)
        const distance = editDistance(word, command)
        if (distance < nearestDistance) {
            nearest = word
            nearestDistance = distance
        }
    }
    // 38.114 — a near miss is named, and the usage is left for a word nothing is near.
    console.error(
        nearest === undefined
            ? `${host.name}: unknown command '${command}'\n\n${usage(host, commands)}`
            : `${host.name}: unknown command '${command}' — did you mean \`${host.name} ${nearest}\`?`,
    )
    return 1
}

// Two edits covers a dropped, doubled or swapped letter; three reaches unrelated words.
const NEAREST_COMMAND_DISTANCE = 2

/** The Levenshtein distance between two words: the fewest insertions, deletions and substitutions. */
function editDistance(from: string, to: string): number {
    let previous: number[] = []
    for (let column = 0; column <= to.length; column++) previous.push(column)
    for (let row = 1; row <= from.length; row++) {
        const current = [row]
        for (let column = 1; column <= to.length; column++)
            current.push(
                Math.min(
                    (previous[column] as number) + 1,
                    (current[column - 1] as number) + 1,
                    (previous[column - 1] as number) +
                        (from[row - 1] === to[column - 1] ? 0 : 1),
                ),
            )
        previous = current
    }
    return previous[to.length] as number
}

// A command, and whether it is one of `SourceCommands` — which a host without them still answers
// (38.51), and does not list (38.52).
type Row = [usage: string, meaning: string, run: Command, sourced: boolean]

function commandsOf(host: Host): Row[] {
    const fromSource = (
        usage: string,
        meaning: string,
        name: keyof SourceCommands,
    ): Row => [
        usage,
        meaning,
        (given) =>
            host.source === undefined
                ? needsSource(host, name)
                : host.source[name](given),
        true,
    ]
    return [
        fromSource('scaffold <name>', 'write a starter project', 'scaffold'),
        [
            'run <file> [args…]',
            'run a script under the abide runtime',
            (given) => run(host, host.app(given), given),
            false,
        ],
        fromSource('dev', 'serve with the compiler in the loop', 'dev'),
        fromSource(
            'build',
            'compile every .abide under the app into .abide/',
            'build',
        ),
        [
            'start',
            'serve the app',
            (given) => start(host, host.app(given), given),
            false,
        ],
        [
            'call <address> [args]',
            'one call to one handler',
            (given) => call(host, host.app(given), given),
            false,
        ],
        [
            'openapi',
            'the OpenAPI document, written rather than served',
            (given) => openapi(host, host.app(given), given),
            false,
        ],
        [
            'mcp',
            "the app's MCP server over stdio",
            (given) => mcp(host, host.app(given), given),
            false,
        ],
        [
            'watch <address> [args]',
            "a live subscription to one of the app's followed GETs",
            (given) => watch(host, given),
            false,
        ],
        fromSource(
            'check [dir…]',
            'type-check the templates and the TypeScript, on the line you wrote',
            'check',
        ),
        fromSource(
            'format [--check] [dir…]',
            'format every .abide — its code by bun fmt, its markup by its nesting',
            'format',
        ),
        fromSource(
            'routes [--json]',
            'every address the app answers, its file, and where each hook is filed',
            'routes',
        ),
        fromSource(
            'compile',
            'the build, as one executable named after the app',
            'compile',
        ),
        fromSource(
            'bundle',
            'the build, as a desktop app for this platform',
            'bundle',
        ),
        fromSource('lsp', 'the .abide language server, over stdio', 'lsp'),
    ]
}

/** Refuses a command that needs the source, pointing at `abide`; returns the exit code. 38.51. */
async function needsSource(host: Host, name: string): Promise<number> {
    console.error(
        `${host.name} ${name}: needs the app's source and the compiler, which this executable does not hold. Run \`abide ${name}\` where the source is.`,
    )
    return 1
}

/**
 * The usage text, listing what the host can run.
 *
 * 38.52 — an executable lists neither the commands it only refuses nor the flags only they read.
 */
function usage(host: Host, commands: Row[]): string {
    const sourced = host.source !== undefined
    let width = 0
    for (const [command, , , needs] of commands)
        if (sourced || !needs) width = Math.max(width, command.length)
    let text = `${host.name} <command>\n${host.name} [--url <origin>]  a shell on the app — served here, or the running one --url names\n\n`
    for (const [command, meaning, , needs] of commands)
        if (sourced || !needs)
            text += `  ${command.padEnd(width)}  ${meaning}\n`
    if (!sourced)
        return `${text}
  --port     the listen port the app is served on
  --url      the running app the shell, call, watch, openapi and mcp talk to
  --method   the method call sends, where the handler answers more than one
  --version  the version of this executable's app
`
    text += `
  --root       the app's source directory, where its pages sit —
               src/ where you stand, or where you stand, whichever has one
  --out        where the build goes, beside the app by default; the file compile and
               bundle write — named after the app, where you stand
  --port       the listen port for dev, start and the shell's app
  --url        the running app the shell, call, watch, openapi and mcp talk to
  --target     the platform compile builds for — linux-x64, darwin-arm64, windows-x64…
  --platforms  several of them, comma-separated, one executable each
  --method     the method call sends, where the handler answers more than one
  --version    the version of abide
`
    return text
}

/** The words and flags `argv` holds, or the parser's refusal of a flag, as one line. */
function parsed(argv: string[]) {
    try {
        return parseFlags(argv)
    } catch (thrown) {
        const { code, message } = thrown as { code?: string; message: string }
        if (!code?.startsWith('ERR_PARSE_ARGS_')) throw thrown
        // Bun's message goes on to advise `--`, which no command here reads.
        const refusal = message.split('. ')[0] as string
        return `${refusal[0]?.toLowerCase()}${refusal.slice(1)}`
    }
}

function parseFlags(argv: string[]) {
    return parseArgs({
        args: argv,
        options: {
            // NO DEFAULT HERE EITHER. `cd ledger && abide dev` is what the docs tell an author to
            // type and `--root ./src` is what an app's own scripts write, so which directory is
            // meant is a question `appRoot` answers rather than one the parser assumes.
            root: { type: 'string' },
            out: { type: 'string' },
            // NO DEFAULT, which is not an omission: `Bun.serve` given no port already reads
            // `PORT` and then falls back to 3000 — `abide dev` scanning on from there, 38.63 — and
            // a default written here would take that away from every host that sets it.
            port: { type: 'string' },
            url: { type: 'string' },
            method: { type: 'string' },
            target: { type: 'string' },
            platforms: { type: 'string' },
            json: { type: 'boolean' },
            check: { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
            version: { type: 'boolean', short: 'v' },
        },
        allowPositionals: true,
    })
}

/**
 * The app served and listening, with the address it answers at and the banner it is announced by —
 * or the exit code of a refusal to. 38.6.
 *
 * Stopped on a signal or an unawaited fault ONCE SERVING, and not before: a boot that fails is
 * 37.6's to fail hard.
 */
async function served(
    host: Host,
    app: AppHandle,
    given: Given,
): Promise<{ app: App; url: string; heading: string } | number> {
    // 36.3 — `dev`, `build` and `start` each name the environment where the process was started with
    // none, and leave one it was started with exactly as given.
    process.env.NODE_ENV ??= 'production'
    const booted = await booting(host, app, given)
    if (typeof booted === 'number') return booted
    const port = given.values.port
    await booted.listen(port === undefined ? {} : { port: Number(port) })
    stopOnSignalOrFault(booted)
    const server = LISTENING.server as Bun.Server<unknown>
    return {
        app: booted,
        url: withoutTrailingSlash(server.url.href),
        heading: banner(host.name, 'start', app.package, server),
    }
}

/** The app booted in this process, or the exit code of a refusal naming why there is none. */
async function booting(
    host: Host,
    app: AppHandle,
    given: Given,
): Promise<App | number> {
    const booted = await app.boot()
    if (typeof booted === 'string') {
        const command = given.positionals[0]
        console.error(
            `${command === undefined ? host.name : `${host.name} ${command}`}: ${booted}`,
        )
        return 1
    }
    return booted
}

/**
 * `start`: serves the app.
 *
 * 38.67 — READS NO INPUT, and hands back no code for the process to exit on: the process is the
 * server, for a container or a supervisor to stop.
 */
async function start(
    host: Host,
    app: AppHandle,
    given: Given,
): Promise<number | undefined> {
    const serving = await served(host, app, given)
    if (typeof serving === 'number') return serving
    console.log(serving.heading)
    return undefined
}

/**
 * The command line with no command: 38.7's shell, on the running app `--url` names or on the app
 * served here.
 *
 * 38.7 — WITH `--url`, BOOTS NOTHING. 38.53 — without, the app served and the shell on it, over http
 * as a remote one's is. 38.54 — `exit` stops the app. 38.55 — input that ends leaves it serving, and
 * hands back no code for the process to exit on.
 */
async function shellOn(
    host: Host,
    app: AppHandle,
    given: Given,
): Promise<number | undefined> {
    const remote = remoteUrl(given.values.url)
    if (remote !== undefined) {
        const url = appUrl(remote)
        await shell({
            url,
            handlers: await app.handlers(),
            heading: `${host.name}: ${url}`,
            local: false,
        })
        return 0
    }
    const serving = await served(host, app, given)
    if (typeof serving === 'number') return serving
    // After the serve, which built the app where nothing had.
    const ended = await shell({
        url: serving.url,
        handlers: await app.handlers(),
        heading: serving.heading,
        local: true,
    })
    if (ended === 'ended') return undefined
    await serving.app.stop()
    return 0
}

/**
 * `run`: runs a script under the abide runtime.
 *
 * 38.2 — the request scope installed, the configuration resolved against the app it stands in,
 * and the script run in a scope of its own — so it imports through `#src/*` and reads
 * `config` without a build.
 *
 * HANDS BACK NO CODE ONCE THE SCRIPT IS RUNNING, as `start` does: the script's top level settling
 * is not the script ending. A timer, a server or a socket it left open keeps the process alive,
 * and a `process.exitCode` it set is what the process exits with.
 */
async function run(
    host: Host,
    app: AppHandle,
    { positionals: [, file, ...rest] }: Given,
): Promise<number | undefined> {
    if (file === undefined) {
        console.error(
            `${host.name} run: name the file — ${host.name} run <file> [args…]`,
        )
        return 1
    }
    const path = resolve(file)
    process.argv = [process.argv[0] as string, path, ...rest]
    // 38.57 — entered as `bootApp` enters it, its server blocks aside: a script is run against the
    // app's source, which nothing built.
    await enterApp({ hooks: undefined, package: app.package })
    await inScope(undefined, () => import(Bun.pathToFileURL(path).href))
    return undefined
}

/** `watch <address> [args]`: a `GET`'s value and each patch, as its event stream sends them (38.69). */
async function watch(host: Host, given: Given): Promise<number> {
    const {
        positionals: [, address, ...args],
        values: { url },
    } = given
    if (address === undefined) {
        console.error(
            `${host.name} watch: name the GET — ${host.name} watch chat/room room=lobby`,
        )
        return 1
    }
    return watchAddress(appUrl(url), address, args).catch((thrown: Error) => {
        console.error(`${host.name} watch: ${thrown.message}`)
        return 1
    })
}

/** `call`: one call to one handler on a running app. 38.8. */
async function call(host: Host, app: AppHandle, given: Given): Promise<number> {
    const {
        positionals: [, address, ...args],
        values: { url, method },
    } = given
    if (address === undefined) {
        console.error(
            `${host.name} call: name the handler — ${host.name} call invoices/getInvoice id=4310`,
        )
        return 1
    }
    const answered = await callHandler(
        appUrl(url),
        address,
        args,
        method,
        await app.handlers(),
    ).catch((thrown: Error) => ({ code: 1, text: thrown.message }))
    if (answered.text !== '')
        (answered.code === 0 ? console.log : console.error)(answered.text)
    return answered.code
}

/**
 * A fetch against a generated surface, on the app `--url` names or on one booted here — or the exit
 * code of a refusal to boot one.
 *
 * 38.9 — the app booted in this process derives it from the same route table the served one does.
 */
async function surfaceAt(
    host: Host,
    app: AppHandle,
    given: Given,
    address: string,
): Promise<
    | ((
          init?: RequestInit & { headers?: Record<string, string> },
      ) => Promise<Response>)
    | number
> {
    const remote = remoteUrl(given.values.url)
    if (remote !== undefined)
        return (init) =>
            fetch(`${appUrl(remote)}${address}`, {
                ...init,
                headers: { ...init?.headers, ...remoteHeaders() },
            })
    const booted = await booting(host, app, given)
    if (typeof booted === 'number') return booted
    return (init) =>
        booted.fetch(new Request(`${IN_PROCESS_ORIGIN}${address}`, init))
}

/**
 * `openapi`: prints the OpenAPI document — redirected to a file, where one is wanted.
 *
 * 38.9 — from `--url` where one is given and from the app in this process where not.
 */
async function openapi(
    host: Host,
    app: AppHandle,
    given: Given,
): Promise<number> {
    const ask = await surfaceAt(host, app, given, OPENAPI_ADDRESS)
    if (typeof ask === 'number') return ask
    const answer = await ask()
    if (!answer.ok) {
        console.error(
            `${host.name} openapi: the app answered ${answer.status}. The document lists every handler with openapi in its clients; none is.`,
        )
        return 1
    }
    console.log(JSON.stringify(await answer.json(), null, 4))
    return 0
}

/**
 * `mcp`: the app's MCP server over stdio.
 *
 * 38.9, 38.13 — a bridge a model client spawns and kills: each line in is a JSON-RPC message for
 * `/__abide/mcp`, and each answer is a line out.
 */
async function mcp(host: Host, app: AppHandle, given: Given): Promise<number> {
    const ask = await surfaceAt(host, app, given, MCP_ADDRESS)
    if (typeof ask === 'number') return ask
    for await (const line of console) {
        if (line.trim() === '') continue
        const answer = await ask({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: line,
        })
        const text = await answer.text()
        if (text !== '') process.stdout.write(`${text}\n`)
    }
    return 0
}
