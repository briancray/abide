#!/usr/bin/env bun
import { abideLsp } from '../src/abideLsp.ts'
import { build } from '../src/build.ts'
import { buildCli } from '../src/buildCli.ts'
import { bundleApp } from '../src/bundleApp.ts'
import { checkAbide } from '../src/checkAbide.ts'
import { compile } from '../src/compile.ts'
import { initAgent } from '../src/initAgent.ts'
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
Runs an arbitrary script under the abide preload — same runtime as the server,
so jobs/scripts get .abide compilation, abide/* + $server/$shared resolution,
and the .css no-op loader for free. Everything after `run` is forwarded
verbatim: the first token is the script, the rest are its argv (bun stops
parsing its own flags at the script path).
*/
async function runCmd(): Promise<void> {
    if (rest.length === 0) {
        console.error('usage: abide run <file> [args...]')
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
// dist/cli-thin/<platform>/ (cli + server) — the layout the /__abide/cli
// download endpoint streams. For just the server, use `abide compile`.
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

// Type-checks every .abide component's template + props through its shadow and
// exits non-zero if any errors are found.
async function checkCmd(): Promise<void> {
    const errors = await checkAbide({ cwd })
    process.exit(errors === 0 ? 0 : 1)
}

// Runs the .abide language server over stdio (JSON-RPC) — an editor spawns this
// to get live template + prop type-check diagnostics. Runs until the client exits.
async function lspCmd(): Promise<void> {
    await abideLsp({ cwd })
}

// Assembles a movable, self-contained app bundle for the host platform —
// the server binary, the launcher, and the webview lib together (a .app on
// macOS, a flat directory elsewhere). Unsigned; for distribution to other
// users the bundle still needs platform signing/notarization.
async function bundleCmd(): Promise<void> {
    await bundleApp({ cwd })
}

/*
Scaffolds the bundled template, installs it, and — interactively — starts the
dev server so the one command ends in a running app. Non-TTY runs (CI,
scripts) never auto-start; `--no-dev` opts out explicitly.
*/
async function scaffoldCmd(): Promise<void> {
    const name = rest.find((arg) => !arg.startsWith('--'))
    if (!name) {
        console.error('usage: bunx abide scaffold <project-name> [--no-install] [--no-dev]')
        process.exit(1)
    }
    const install = !rest.includes('--no-install')
    // scaffold gates dev on a successful install, so only the TTY/flag policy lives here.
    const dev = !rest.includes('--no-dev') && Boolean(process.stdout.isTTY)
    await scaffold({ cwd, name, install, dev })
}

// Writes/refreshes the abide agent-guide pointer in the project's root CLAUDE.md so
// Claude (which never reads node_modules) is told where abide's surface map lives.
// For projects that added abide as a dependency without scaffolding.
async function initAgentCmd(): Promise<void> {
    await initAgent({ cwd })
}

// Prints the CLI synopsis to stderr and exits non-zero. Marked `never` because the process is gone.
function usage(): never {
    console.error(
        'usage:\n' +
            '  bunx abide scaffold <project-name>   scaffold a new abide project, install\n' +
            '                                       it, and start its dev server\n' +
            '                                       (--no-install / --no-dev to skip)\n' +
            '  abide dev                            build + run with hot reload\n' +
            '  abide build                          build the client into dist/_app/\n' +
            '  abide check                          type-check .abide templates + props\n' +
            '  abide start                          run the production server against dist/\n' +
            '  abide run <file> [args...]           run a script under the abide preload\n' +
            '                                       (jobs, one-off scripts — same runtime as\n' +
            '                                       the server). For tests, add\n' +
            '                                       preload = ["@abide/abide/preload"] under\n' +
            '                                       [test] in bunfig.toml and use `bun test`\n' +
            '  abide compile [--target=<bun-...>] [--out=<path>]\n' +
            '                                       build a standalone server executable\n' +
            '  abide cli [--target=<bun-...>] [--out=<path>] [--platforms=<a,b,c>]\n' +
            '                                       build the cli binary — a thin remote client that\n' +
            '                                       ships the server beside it (connect to a remote\n' +
            '                                       server or `start` a local instance; --platforms\n' +
            '                                       cross-compiles per platform)\n' +
            '  abide bundle                         build a movable, self-contained app\n' +
            '                                       bundle for this platform (unsigned). Boots\n' +
            '                                       into a connect screen — start the embedded\n' +
            '                                       server or connect to a remote one\n' +
            "  abide init-agent                     write/refresh a CLAUDE.md pointer to abide's\n" +
            '                                       surface map (for non-scaffolded projects)',
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
} else if (command === 'check') {
    await checkCmd()
} else if (command === 'lsp') {
    await lspCmd()
} else if (command === 'init-agent') {
    await initAgentCmd()
} else {
    usage()
}
