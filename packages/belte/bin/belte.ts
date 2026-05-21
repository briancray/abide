#!/usr/bin/env bun
import { build } from '../src/build.ts'
import { compile } from '../src/compile.ts'
import { normalizeTarget } from '../src/lib/shared/normalizeTarget.ts'

const PRELOAD = new URL('../src/preload.ts', import.meta.url).pathname
const SERVER_ENTRY = new URL('../src/serverEntry.ts', import.meta.url).pathname
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

// Runs a client build and then starts the server in hot-reload mode under the belte preload.
// Awaits the child process so the parent's exit code mirrors the server's.
async function dev(): Promise<void> {
    await build({ cwd })
    const child = Bun.spawn({
        cmd: ['bun', '--hot', '--preload', PRELOAD, SERVER_ENTRY],
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

// Prints the CLI synopsis to stderr and exits non-zero. Marked `never` because the process is gone.
function usage(): never {
    console.error('usage: belte <dev|build|start|compile> [--target=<bun-...>] [--out=<path>]')
    process.exit(1)
}

if (command === 'dev') {
    await dev()
} else if (command === 'build') {
    await buildOnce()
} else if (command === 'start') {
    await start()
} else if (command === 'compile') {
    await compileCmd()
} else {
    usage()
}
