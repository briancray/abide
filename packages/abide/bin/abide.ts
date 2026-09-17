#!/usr/bin/env bun
// The `abide` CLI. Commands are addresses, not names, so they live in one dispatch
// rather than a file each until one of them grows a reason to move.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own
import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet

import { compileFile, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'

const USAGE = `abide <command>

  build    compile every .abide under the app into .abide/ (--out to change)
  start    serve a built app
  dev      serve with the compiler in the loop
`

async function build(root: string, out: string): Promise<number> {
    const sources = [
        ...new Bun.Glob('**/*.abide').scanSync({ cwd: root, absolute: true }),
    ]
    if (sources.length === 0) {
        console.log(`abide build: no .abide sources under ${root}`)
        return 0
    }
    // `--out` is a real flag rather than a constant because two test files each building into
    // one `.abide/` is the contention CLAUDE.md's "checks" section already records once.
    // One session for the whole build: opening it spawns the checker, and the cost is paid once
    // rather than per file. Where no tsconfig is found the build still runs and every name reads
    // as written — 19.12 rather than a refusal.
    const tsconfig = findTsconfig(root)
    const session =
        tsconfig === undefined ? undefined : await TypeSession.open(tsconfig)
    try {
        for (const source of sources) {
            const relative = source.slice(root.length + 1)
            const target = `${out}/${relative.replace(/\.abide$/, '.ts')}`
            const text = await Bun.file(source).text()
            const file = parseAbide(text)
            const reactive = await session?.reactiveNames(source, file)
            await Bun.write(target, compileFile(text, reactive))
        }
    } finally {
        session?.close()
    }
    console.log(`abide build: ${sources.length} source(s) -> ${out}`)
    return 0
}

// The nearest tsconfig.json at or above `from`. The compiler needs a project for 31.3, and an
// app's own is the one whose paths and lib its pages are written against.
function findTsconfig(from: string): string | undefined {
    let at = from
    while (true) {
        const candidate = `${at}/tsconfig.json`
        if (existsSync(candidate)) return candidate
        const up = dirname(at)
        if (up === at) return undefined
        at = up
    }
}

async function main(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            root: { type: 'string', default: process.cwd() },
            out: { type: 'string', default: '.abide' },
        },
        allowPositionals: true,
    })
    const command = positionals[0]

    switch (command) {
        case 'build':
            return await build(values.root, values.out)
        case 'start':
        case 'dev':
            throw new Error(`abide ${command}: not implemented`)
        case undefined:
        case 'help':
            console.log(USAGE)
            return 0
        default:
            console.error(`abide: unknown command '${command}'\n\n${USAGE}`)
            return 1
    }
}

process.exit(await main(Bun.argv.slice(2)))
