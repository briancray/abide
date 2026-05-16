#!/usr/bin/env bun
import { build } from '../src/build.ts'
import { compile, normalizeTarget } from '../src/compile.ts'

const PRELOAD = new URL('../src/preload.ts', import.meta.url).pathname
const SERVER_ENTRY = new URL('../src/serverEntry.ts', import.meta.url).pathname
const cwd = process.cwd()
const [, , command, ...rest] = process.argv

function parseFlag(name: string): string | undefined {
    const prefix = `--${name}=`
    const match = rest.find((arg) => arg.startsWith(prefix))
    if (match) {
        return match.slice(prefix.length)
    }
    const idx = rest.indexOf(`--${name}`)
    if (idx !== -1 && idx + 1 < rest.length) {
        return rest[idx + 1]
    }
    return undefined
}

async function dev(): Promise<void> {
    await build({ cwd })
    Bun.spawn({
        cmd: ['bun', '--hot', '--preload', PRELOAD, SERVER_ENTRY],
        cwd,
        stdio: ['inherit', 'inherit', 'inherit'],
    })
}

async function buildOnce(): Promise<void> {
    await build({ cwd })
}

function start(): void {
    Bun.spawn({
        cmd: ['bun', '--preload', PRELOAD, SERVER_ENTRY],
        cwd,
        stdio: ['inherit', 'inherit', 'inherit'],
    })
}

async function compileCmd(): Promise<void> {
    const targetFlag = parseFlag('target')
    const outFlag = parseFlag('out')
    await compile({
        cwd,
        target: targetFlag ? normalizeTarget(targetFlag) : undefined,
        outfile: outFlag,
    })
}

function usage(): never {
    console.error('usage: belte <dev|build|start|compile> [--target=<bun-...>] [--out=<path>]')
    process.exit(1)
}

if (command === 'dev') {
    await dev()
} else if (command === 'build') {
    await buildOnce()
} else if (command === 'start') {
    start()
} else if (command === 'compile') {
    await compileCmd()
} else {
    usage()
}
