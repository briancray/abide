#!/usr/bin/env bun
// The `abide` CLI. Commands are addresses, not names, so they live in one dispatch
// rather than a file each until one of them grows a reason to move.

import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet

const USAGE = `abide <command>

  build    compile every .abide under the app into .abide/
  start    serve a built app
  dev      serve with the compiler in the loop
`

async function build(root: string): Promise<number> {
    const sources = [...new Bun.Glob('**/*.abide').scanSync({ cwd: root, absolute: true })]
    if (sources.length === 0) {
        console.log(`abide build: no .abide sources under ${root}`)
        return 0
    }
    throw new Error(`abide build: ${sources.length} source(s) found, compiler not implemented`)
}

async function main(argv: string[]): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        options: { root: { type: 'string', default: process.cwd() } },
        allowPositionals: true,
    })
    const command = positionals[0]

    switch (command) {
        case 'build':
            return await build(values.root)
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
