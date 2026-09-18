#!/usr/bin/env bun
// The `abide` CLI. Commands are addresses, not names, so they live in one dispatch
// rather than a file each until one of them grows a reason to move.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own
import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet

import type { AbideFile } from '#compiler'
import { compileFile, emitClient, parseAbide } from '#compiler'
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
        const parsed: { path: string; file: AbideFile; text: string }[] = []
        for (const source of sources) {
            const text = await Bun.file(source).text()
            parsed.push({ path: source, file: parseAbide(text), text })
        }

        // ONE SNAPSHOT FOR THE WHOLE BUILD. Asking file by file costs 19.7 ms each against 0.8 ms
        // sharing one, because what is expensive is adding a file to the project's root set
        // rather than asking about it — and a fresh build adds every file it has.
        const names = await session?.reactiveNamesFor(parsed)

        for (let at = 0; at < parsed.length; at += 1) {
            const entry = parsed[at] as (typeof parsed)[number]
            const relative = entry.path.slice(root.length + 1)
            const reactive = names?.[at]
            await Bun.write(
                `${out}/${relative.replace(/\.abide$/, '.ts')}`,
                compileFile(entry.text, reactive),
            )

            // The client module is emitted only where there is something to hydrate. A static
            // page has no `.client.ts` beside it, which is what makes "this page ships no
            // runtime" a fact about the build rather than a claim about the bundler.
            const client = emitClient(entry.file, reactive)
            if (client !== '')
                await Bun.write(
                    `${out}/${relative.replace(/\.abide$/, '.client.ts')}`,
                    client,
                )
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
