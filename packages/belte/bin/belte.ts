#!/usr/bin/env bun
import { build } from '../src/build.ts'
import { buildCli } from '../src/buildCli.ts'
import { bundleApp } from '../src/bundleApp.ts'
import { compile } from '../src/compile.ts'
import { normalizeTarget } from '../src/lib/shared/normalizeTarget.ts'
import { scaffold } from '../src/scaffold.ts'

const PRELOAD = new URL('../src/preload.ts', import.meta.url).pathname
const SERVER_ENTRY = new URL('../src/serverEntry.ts', import.meta.url).pathname
const DEV_ENTRY = new URL('../src/devEntry.ts', import.meta.url).pathname
const cwd = process.cwd()
const [, , command, ...rest] = process.argv

// Reads `--name=value` or `--name value` from the trailing argv tail.
function parseFlag(name: string): string | undefined {
    const prefix = `--${name}=`
    const match = rest.find((arg) => arg.startsWith(prefix))
    if (match) {
        return match.slice(prefix.length)
    }
    const index = rest.indexOf(`--${name}`)
    if (index !== -1 && index + 1 < rest.length) {
        return rest[index + 1]
    }
    return undefined
}

/*
Runs a long-lived child (server, job, script) and owns its shutdown. Ctrl+C
delivers SIGINT to the whole foreground process group, so without a parent
handler the parent's default action kills it instantly — abandoning the
`await child.exited` and orphaning the child, which (for a server) can then
linger holding the port. Forwarding the signal and awaiting the child's exit
(with a SIGKILL watchdog for a wedged child) guarantees the child is reaped
before the parent leaves. Mirrors the child's exit code so callers and CI see
the real result.
*/
async function runChild(cmd: string[]): Promise<never> {
    const child = Bun.spawn({ cmd, cwd, stdio: ['inherit', 'inherit', 'inherit'] })
    const forward = (signal: NodeJS.Signals) => {
        child.kill(signal)
        setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    }
    process.on('SIGINT', () => forward('SIGINT'))
    process.on('SIGTERM', () => forward('SIGTERM'))
    process.exit(await child.exited)
}

/*
Runs the dev orchestrator (devEntry) — not `bun --watch`. The orchestrator owns
the loop: it builds the client, spawns the server as a child on a fixed dev
port, watches src/ recursively, and on any change rebuilds + restarts the child.
The server mounts a live-reload channel under dev, so the browser reloads itself
when the restarted server comes back. runChild forwards Ctrl+C so the
orchestrator (and its server child) shut down cleanly.
*/
async function dev(): Promise<void> {
    await runChild(['bun', '--preload', PRELOAD, DEV_ENTRY])
}

// Performs a single client build with no server attached (for CI / static deploys).
async function buildOnce(): Promise<void> {
    await build({ cwd })
}

// Starts the production server against an already-built dist directory.
async function start(): Promise<void> {
    await runChild(['bun', '--preload', PRELOAD, SERVER_ENTRY])
}

/*
Runs an arbitrary script under the belte preload — same runtime as the server,
so jobs/scripts get .svelte compilation, belte/* + $server/$shared resolution,
and the .css no-op loader for free. Everything after `run` is forwarded
verbatim: the first token is the script, the rest are its argv (bun stops
parsing its own flags at the script path).
*/
async function runCmd(): Promise<void> {
    if (rest.length === 0) {
        console.error('usage: belte run <file> [args...]')
        process.exit(1)
    }
    await runChild(['bun', '--preload', PRELOAD, ...rest])
}

// Parses the --target and --out flags and produces a standalone executable.
async function compileCmd(): Promise<void> {
    const targetFlag = parseFlag('target')
    const outFlag = parseFlag('out')
    await compile({
        cwd,
        target: targetFlag ? normalizeTarget(targetFlag) : undefined,
        outfile: outFlag,
    })
}

// Builds the standalone CLI binary — a thin remote client (manifest baked in)
// that ships the compiled server beside it, so it can talk to a remote server
// or spawn a local instance (`<name> start`). Discovery walks the rpc registry
// to bake the manifest in. `--platforms a,b,c` cross-compiles per target into
// dist/cli-thin/<platform>/ (cli + server) — the layout the /__belte/cli
// download endpoint streams. For just the server, use `belte compile`.
async function cliCmd(): Promise<void> {
    const targetFlag = parseFlag('target')
    const outFlag = parseFlag('out')
    const platformsFlag = parseFlag('platforms')
    const platforms = platformsFlag
        ? platformsFlag.split(',').map((value) => normalizeTarget(value.trim()))
        : undefined
    await buildCli({
        cwd,
        target: targetFlag ? normalizeTarget(targetFlag) : undefined,
        outfile: outFlag,
        platforms,
    })
}

// Assembles a movable, self-contained app bundle for the host platform —
// the server binary, the launcher, and the webview lib together (a .app on
// macOS, a flat directory elsewhere). Unsigned; for distribution to other
// users the bundle still needs platform signing/notarization.
async function bundleCmd(): Promise<void> {
    await bundleApp({ cwd })
}

// Scaffolds the bundled template into a new project directory.
async function scaffoldCmd(): Promise<void> {
    const name = rest.find((arg) => !arg.startsWith('--'))
    if (!name) {
        console.error('usage: bunx belte scaffold <project-name>')
        process.exit(1)
    }
    await scaffold({ cwd, name })
}

// Prints the CLI synopsis to stderr and exits non-zero. Marked `never` because the process is gone.
function usage(): never {
    console.error(
        'usage:\n' +
            '  bunx belte scaffold <project-name>   scaffold a new belte project\n' +
            '  belte dev                            build + run with hot reload\n' +
            '  belte build                          build the client into dist/_app/\n' +
            '  belte start                          run the production server against dist/\n' +
            '  belte run <file> [args...]           run a script under the belte preload\n' +
            '                                       (jobs, one-off scripts — same runtime as\n' +
            '                                       the server). For tests, add\n' +
            '                                       preload = ["@belte/belte/preload"] under\n' +
            '                                       [test] in bunfig.toml and use `bun test`\n' +
            '  belte compile [--target=<bun-...>] [--out=<path>]\n' +
            '                                       build a standalone server executable\n' +
            '  belte cli [--target=<bun-...>] [--out=<path>] [--platforms=<a,b,c>]\n' +
            '                                       build the cli binary — a thin remote client that\n' +
            '                                       ships the server beside it (connect to a remote\n' +
            '                                       server or `start` a local instance; --platforms\n' +
            '                                       cross-compiles per platform)\n' +
            '  belte bundle                         build a movable, self-contained app\n' +
            '                                       bundle for this platform (unsigned). Boots\n' +
            '                                       into a connect screen — start the embedded\n' +
            '                                       server or connect to a remote one',
    )
    process.exit(1)
}

if (command === 'scaffold') {
    await scaffoldCmd()
} else if (command === 'dev') {
    await dev()
} else if (command === 'build') {
    await buildOnce()
} else if (command === 'start') {
    await start()
} else if (command === 'run') {
    await runCmd()
} else if (command === 'compile') {
    await compileCmd()
} else if (command === 'cli') {
    await cliCmd()
} else if (command === 'bundle') {
    await bundleCmd()
} else {
    usage()
}
