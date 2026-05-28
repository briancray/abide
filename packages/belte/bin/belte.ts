#!/usr/bin/env bun
import { build } from '../src/build.ts'
import { buildCli } from '../src/buildCli.ts'
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
Spawns the server under `bun --watch` against the dev entry. The dev entry
re-runs the client build and eagerly imports every page/layout/rpc/socket
module on each boot, so Bun's watcher sees them from the start and
restarts the whole process whenever any file in the graph changes. The
browser is not auto-reloaded — refresh manually after the server is back.
*/
async function dev(): Promise<void> {
    const child = Bun.spawn({
        cmd: ['bun', '--watch', '--preload', PRELOAD, DEV_ENTRY],
        cwd,
        stdio: ['inherit', 'inherit', 'inherit'],
    })
    process.exit(await child.exited)
}

// Performs a single client build with no server attached (for CI / static deploys).
async function buildOnce(): Promise<void> {
    await build({ cwd })
}

// Starts the production server against an already-built dist directory.
// Awaits the child process so the parent's exit code mirrors the server's.
async function start(): Promise<void> {
    const child = Bun.spawn({
        cmd: ['bun', '--preload', PRELOAD, SERVER_ENTRY],
        cwd,
        stdio: ['inherit', 'inherit', 'inherit'],
    })
    process.exit(await child.exited)
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

// Builds the standalone CLI binary. Defaults to full (backend embedded, runs
// locally); `--thin` builds the remote client (manifest only, needs APP_URL
// at runtime). Discovery walks the rpc registry to bake the manifest in.
// `--platforms a,b,c` cross-compiles per target — thin binaries land in
// dist/cli-thin/<platform>/ (the layout the /__belte/cli download endpoint
// streams), full binaries in dist/cli/<platform>/.
async function cliCmd(): Promise<void> {
    const targetFlag = parseFlag('target')
    const outFlag = parseFlag('out')
    const platformsFlag = parseFlag('platforms')
    const thin = rest.includes('--thin')
    const platforms = platformsFlag
        ? platformsFlag.split(',').map((value) => normalizeTarget(value.trim()))
        : undefined
    await buildCli({
        cwd,
        target: targetFlag ? normalizeTarget(targetFlag) : undefined,
        outfile: outFlag,
        platforms,
        thin,
    })
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
            '  belte compile [--target=<bun-...>] [--out=<path>]\n' +
            '                                       build a standalone server executable\n' +
            '  belte cli [--thin] [--target=<bun-...>] [--out=<path>] [--platforms=<a,b,c>]\n' +
            '                                       build the cli binary (full by default — runs\n' +
            '                                       locally; --thin builds the remote client;\n' +
            '                                       --platforms cross-compiles per platform)',
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
} else if (command === 'compile') {
    await compileCmd()
} else if (command === 'cli') {
    await cliCmd()
} else {
    usage()
}
