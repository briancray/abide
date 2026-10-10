// 38.13 — THE COMMAND LINE, for both hosts that have one: `abide`, over an app on disk, and a
// compiled app's executable, over the app it holds (38.51). One list, so a command either has is a
// command both have — the executable answers the ones that need the source and the compiler with a
// refusal naming `abide`, rather than not knowing them.

import { resolve } from 'node:path' // bun exposes no path helpers of its own
import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet
import { MCP_ADDRESS, OPENAPI_ADDRESS } from '#shared/ADDRESSES.ts'
import type { Mount } from './answerRpc.ts'
import { banner } from './banner.ts'
import { APP_PACKAGE, type AppPackage, config } from './config.ts'
import type { App } from './createApp.ts'
import { installServer } from './installServer.ts'
import {
    appUrl,
    callHandler,
    followLogs,
    remoteHeaders,
    remoteUrl,
    watch as watchAddress,
} from './remote.ts'
import { inScope, LISTENING } from './requestScope.ts'
import { shell } from './shell.ts'
import { withoutTrailingSlash } from './withoutTrailingSlash.ts'

/** What a command is handed: the words after the flags, the command's own first, and the flags. */
export type Given = ReturnType<typeof parsed>

type Command = (given: Given) => Promise<number | undefined>

/** The commands that need the app's source and the compiler, which only `abide` holds. */
type SourceCommands = Record<
    'scaffold' | 'dev' | 'build' | 'check' | 'compile' | 'lsp',
    Command
>

/** Where the app a command means is — everything the two hosts differ in. */
export type Host = {
    /** What usage and every message speak as: `abide`, or the name the executable was run by. */
    name: string
    /**
     * The handler table the shell lists and a call reads a handler's method off — so a call is
     * spelled the same whatever the handler's method, and `--method` is only for an app nobody here
     * knows the table of. Empty where there is none to read.
     */
    handlers: (given: Given) => Promise<Mount[]>
    /** The identity a script `run` resolves its configuration with. 27.3. */
    appPackage: () => AppPackage
    /** The app booted in this process: `openapi` and `mcp`'s answer where no `--url` is given. */
    boot: () => Promise<App>
    /** The app served, or the exit code of a refusal to. 38.6. */
    serve: (given: Given) => Promise<App | number>
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
    // 38.2 — EVERYTHING AFTER THE FILE IS THE SCRIPT'S, flags included, so `run` is taken before the
    // parser sees an argument it does not know.
    const given: Given =
        argv[0] === 'run' ? { positionals: argv, values: {} } : parsed(argv)
    const command = given.positionals[0]
    const commands = commandsOf(host)
    if (command === 'help' || given.values.help) {
        console.log(usage(host, commands))
        return 0
    }
    if (command === undefined) return await shellOn(host, given)
    for (const [name, , body] of commands)
        if (name.split(' ')[0] === command) return await body(given)
    console.error(
        `${host.name}: unknown command '${command}'\n\n${usage(host, commands)}`,
    )
    return 1
}

// A command, and whether it is one of `SourceCommands` — which a host without them still answers
// (38.52), and does not list (38.53).
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
            (given) => run(host, given),
            false,
        ],
        fromSource('dev', 'serve with the compiler in the loop', 'dev'),
        fromSource(
            'build',
            'compile every .abide under the app into .abide/',
            'build',
        ),
        ['start', 'serve the app', (given) => start(host, given), false],
        [
            'call <address> [args]',
            'one call to one handler',
            (given) => call(host, given),
            false,
        ],
        [
            'openapi',
            'the OpenAPI document, written rather than served',
            (given) => openapi(host, given),
            false,
        ],
        [
            'mcp',
            "the app's MCP server over stdio",
            (given) => mcp(host, given),
            false,
        ],
        [
            'logs',
            'a live subscription to log.records',
            ({ values }) => followLogs(appUrl(values.url)),
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
            'compile',
            'the build, as one executable named after the app',
            'compile',
        ),
        [
            'bundle',
            'not built yet',
            async () => {
                console.error(`${host.name} bundle: not built yet.`)
                return 1
            },
            // Wraps a build, so an executable is no more a place for it than for `build`.
            true,
        ],
        fromSource('lsp', 'the .abide language server, over stdio', 'lsp'),
    ]
}

/** Refuses a command that needs the source, pointing at `abide`; returns the exit code. 38.52. */
async function needsSource(host: Host, name: string): Promise<number> {
    console.error(
        `${host.name} ${name}: needs the app's source and the compiler, which this executable does not hold. Run \`abide ${name}\` where the source is.`,
    )
    return 1
}

/**
 * The usage text, listing what the host can run.
 *
 * 38.53 — an executable lists neither the commands it only refuses nor the flags only they read.
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
  --port  the listen port the app is served on
  --url   the running app the shell, call, logs, openapi and mcp talk to
  --out   the file openapi writes
`
    text += `
  --root       the app's source directory, the one ui/ sits under —
               src/ where you stand, or where you stand, whichever has one
  --out        where the build goes, beside the app by default; the file openapi and
               compile write — compile's is the app's name, where you stand
  --port       the listen port for dev, start and the shell's app
  --url        the running app the shell, call, logs, openapi and mcp talk to
  --target     the platform compile builds for — linux-x64, darwin-arm64, windows-x64…
  --platforms  several of them, comma-separated, one executable each
`
    return text
}

function parsed(argv: string[]) {
    return parseArgs({
        args: argv,
        options: {
            // NO DEFAULT HERE EITHER. `cd ledger && abide dev` is what the docs tell an author to
            // type and `--root ./src` is what an app's own scripts write, so which directory is
            // meant is a question `appRoot` answers rather than one the parser assumes.
            root: { type: 'string' },
            out: { type: 'string' },
            // NO DEFAULT, which is not an omission: `Bun.serve` given no port already reads
            // `PORT` and then falls back to 3000 — `abide dev` scanning on from there, 38.64 — and
            // a default written here would take that away from every host that sets it.
            port: { type: 'string' },
            url: { type: 'string' },
            method: { type: 'string' },
            target: { type: 'string' },
            platforms: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
    })
}

/** The app served, with the address it answers at and the banner it is announced by. 38.6. */
async function served(
    host: Host,
    given: Given,
): Promise<{ app: App; url: string; heading: string } | number> {
    // 36.3 — `dev`, `build` and `start` each name the environment where the process was started with
    // none, and leave one it was started with exactly as given.
    process.env.NODE_ENV ??= 'production'
    const app = await host.serve(given)
    if (typeof app === 'number') return app
    const server = LISTENING.server as Bun.Server<unknown>
    return {
        app,
        url: withoutTrailingSlash(server.url.href),
        heading: banner(host.name, 'start', host.appPackage(), server),
    }
}

/**
 * `start`: serves the app.
 *
 * 38.68 — READS NO INPUT, and hands back no code for the process to exit on: the process is the
 * server, for a container or a supervisor to stop.
 */
async function start(host: Host, given: Given): Promise<number | undefined> {
    const serving = await served(host, given)
    if (typeof serving === 'number') return serving
    console.log(serving.heading)
    return undefined
}

/**
 * The command line with no command: 38.7's shell, on the running app `--url` names or on the app
 * served here.
 *
 * 38.7 — WITH `--url`, BOOTS NOTHING. 38.54 — without, the app served and the shell on it, over http
 * as a remote one's is. 38.55 — `exit` stops the app. 38.56 — input that ends leaves it serving, and
 * hands back no code for the process to exit on.
 */
async function shellOn(host: Host, given: Given): Promise<number | undefined> {
    const handlers = await host.handlers(given)
    const remote = remoteUrl(given.values.url)
    if (remote !== undefined) {
        const url = appUrl(remote)
        await shell({
            url,
            handlers,
            heading: `${host.name}: ${url}`,
            local: false,
        })
        return 0
    }
    const serving = await served(host, given)
    if (typeof serving === 'number') return serving
    const ended = await shell({
        url: serving.url,
        handlers,
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
 * and the script run in a scope of its own — so it imports `#server` and `#shared` and reads
 * `config` without a build.
 *
 * HANDS BACK NO CODE ONCE THE SCRIPT IS RUNNING, as `start` does: the script's top level settling
 * is not the script ending. A timer, a server or a socket it left open keeps the process alive,
 * and a `process.exitCode` it set is what the process exits with.
 */
async function run(
    host: Host,
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
    // 38.58 — RE-RESOLVED, as `bootApp` does: a module this process loaded before the script may already have
    // read the configuration, under no identity.
    installServer()
    APP_PACKAGE.current = host.appPackage()
    config.invalidate()
    await inScope(undefined, () => import(Bun.pathToFileURL(path).href))
    return undefined
}

/** `call`: one call to one handler on a running app. 38.8. */
/** `watch <address> [args]`: a `GET`'s value and each patch, as its event stream sends them (38.70). */
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

async function call(host: Host, given: Given): Promise<number> {
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
        await host.handlers(given),
    ).catch((thrown: Error) => ({ code: 1, text: thrown.message }))
    if (answered.text !== '')
        (answered.code === 0 ? console.log : console.error)(answered.text)
    return answered.code
}

/**
 * A fetch against a generated surface, on the app `--url` names or on one booted here.
 *
 * 38.9 — the app booted in this process has that surface opened, and derives it from the same
 * route table the served one does.
 */
async function surfaceAt(
    host: Host,
    url: string | undefined,
    surface: string,
    address: string,
): Promise<
    (
        init?: RequestInit & { headers?: Record<string, string> },
    ) => Promise<Response>
> {
    const remote = remoteUrl(url)
    if (remote !== undefined)
        return (init) =>
            fetch(`${appUrl(remote)}${address}`, {
                ...init,
                headers: { ...init?.headers, ...remoteHeaders() },
            })
    process.env[surface] = '1'
    const app = await host.boot()
    return (init) =>
        app.fetch(new Request(`http://abide.local${address}`, init))
}

/**
 * `openapi`: writes the OpenAPI document.
 *
 * 38.9 — from `--url` where one is given and from the app in this process where not.
 */
async function openapi(
    host: Host,
    { values: { url, out } }: Given,
): Promise<number> {
    const answer = await (
        await surfaceAt(host, url, 'ABIDE_OPENAPI', OPENAPI_ADDRESS)
    )()
    if (!answer.ok) {
        console.error(
            `${host.name} openapi: the app answered ${answer.status}. ABIDE_OPENAPI opens the document.`,
        )
        return 1
    }
    const text = JSON.stringify(await answer.json(), null, 4)
    if (out === undefined) console.log(text)
    else await Bun.write(resolve(out), `${text}\n`)
    return 0
}

/**
 * `mcp`: the app's MCP server over stdio.
 *
 * 38.9, 38.14 — a bridge a model client spawns and kills: each line in is a JSON-RPC message for
 * `/__abide/mcp`, and each answer is a line out.
 */
async function mcp(host: Host, { values: { url } }: Given): Promise<number> {
    const ask = await surfaceAt(host, url, 'ABIDE_MCP', MCP_ADDRESS)
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
