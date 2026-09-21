#!/usr/bin/env bun
// The `abide` CLI. Commands are addresses, not names, so they live in one dispatch
// rather than a file each until one of them grows a reason to move.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { resolve } from 'node:path' // bun exposes no path helpers of its own
import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet

import { type AppRoute, compileApp } from '#compiler/compileApp.ts'
import {
    CLIENT_DIRECTORY,
    CLIENT_ENTRY,
    PUBLIC_DIRECTORY,
} from '#server/CLIENT_BUILD.ts'
import { serveBuild } from '#server/serveBuild.ts'
import { serveDev } from '#server/serveDev.ts'

const USAGE = `abide <command>

  build    compile every .abide under the app into .abide/ (--out to change)
  start    serve a built app (--port to choose the socket)
  dev      serve with the compiler in the loop

  --root   the app's source directory, the one ui/ sits under
`

async function build(root: string, out: string): Promise<number> {
    // `--out` is a real flag rather than a constant because two test files each building into
    // one `.abide/` is the contention CLAUDE.md's "checks" section already records once.
    const app = await compileApp(root)
    if (app.sources === 0) {
        console.log(`abide build: no .abide sources under ${root}`)
        return 0
    }
    for (const [name, text] of app.modules)
        await Bun.write(`${out}/${name}`, text)
    if (app.routes.length > 0) await bundleClient(out)
    // OUTSIDE THE ROUTE GUARD. An app's static files are its own whether or not it has a page
    // yet, and 36.13's check needs the routes rather than the other way round.
    const published = await copyPublic(root, out, app.routes)
    console.log(
        `abide build: ${app.sources} source(s), ${published} public file(s) -> ${out}`,
    )
    return 0
}

// 38.19 — `src/ui/public`, copied into the built output. Copied rather than left where it is, so
// `abide start` answers out of what the build produced and an app moving a file after a build
// cannot change what is served.
//
// 36.13 IS CHECKED HERE, and this is the only place it can be: a public file and a page route are
// two different walks of two different trees, and the collision is invisible from inside either.
// A build error naming both beats a server that silently prefers one — which is the same bug with
// a reader instead of an author looking at it.
async function copyPublic(
    root: string,
    out: string,
    routes: AppRoute[],
): Promise<number> {
    const from = `${root}/ui/${PUBLIC_DIRECTORY}`
    if (!existsSync(from)) return 0

    const addresses = new Set<string>()
    for (const route of routes) addresses.add(route.pattern)

    let copied = 0
    for (const name of new Bun.Glob('**/*').scanSync({ cwd: from })) {
        // 36.11 — the path below the directory IS the address. `favicon.ico` answers at
        // `/favicon.ico`, and nothing declares that anywhere.
        const address = `/${name}`
        if (addresses.has(address))
            throw new Error(
                `abide build: ui/${PUBLIC_DIRECTORY}/${name} and the page at ${address} claim the same address. RULEBOOK 36.13.`,
            )
        // 36.12 — the bytes as authored. `Bun.write` of a `BunFile` is a copy and not a re-encode.
        await Bun.write(
            `${out}/${PUBLIC_DIRECTORY}/${name}`,
            Bun.file(`${from}/${name}`),
        )
        copied += 1
    }
    return copied
}

// THE BUNDLE. Which module boots the client is the compiler's knowledge — it writes the entry
// into the output tree beside the route table — and this is where that entry becomes a browser
// bundle.
//
// `--splitting`, so a destination's markup and bindings stay in the chunk its own route loads
// (30.11) rather than landing in the entry every page pays for. NOT CONTENT-HASHED and with no
// manifest — that is 38.5 and it is not written yet, which makes this the shape rather than the
// guarantee.
async function bundleClient(out: string): Promise<void> {
    const built = await Bun.build({
        entrypoints: [`${out}/${CLIENT_ENTRY}.ts`],
        outdir: `${out}/${CLIENT_DIRECTORY}`,
        target: 'browser',
        format: 'esm',
        splitting: true,
    })
    // THROWN RATHER THAN LOGGED. A build that emitted server modules and no bundle is an app that
    // serves every page dead — the markup is right and nothing is wired — which is the one failure
    // a reader cannot see, so it stops the command instead.
    if (!built.success)
        throw new AggregateError(
            built.logs,
            'abide build: the client bundle failed',
        )
}

async function main(argv: string[]): Promise<number | undefined> {
    const { values, positionals } = parseArgs({
        args: argv,
        options: {
            root: { type: 'string', default: process.cwd() },
            out: { type: 'string', default: '.abide' },
            // NO DEFAULT, which is not an omission: `Bun.serve` given no port already reads
            // `PORT` and then falls back to 3000, and a default written here would take that
            // away from every host that sets it.
            port: { type: 'string' },
        },
        allowPositionals: true,
    })
    const command = positionals[0]
    // ABSOLUTE, ONCE, HERE. `--root ./src` is what an app's own scripts write, and every consumer
    // below needs the resolved form for a different reason: the checker panics on a relative
    // tsconfig, `import()` of the emitted route table has no base to resolve against, and the
    // walk slices a source path against the root's length.
    const root = resolve(values.root)
    const out = resolve(values.out)

    switch (command) {
        case 'build':
            return await build(root, out)
        case 'start':
            return await start(root, out, values.port)
        case 'dev':
            return await dev(root, values.port)
        case undefined:
        case 'help':
            console.log(USAGE)
            return 0
        default:
            console.error(`abide: unknown command '${command}'\n\n${USAGE}`)
            return 1
    }
}

// 38.4 — the project, watched, with the app kept up. Hands back no exit code for `start`'s
// reason: the process IS the server.
async function dev(root: string, port: string | undefined): Promise<undefined> {
    const server = await serveDev({
        root,
        port: port === undefined ? undefined : Number(port),
    })
    console.log(`abide dev: ${server.url.href}`)
    return undefined
}

// 38.6 — what `abide build` produced, served. Hands back no exit code and that is the signal:
// the process IS the server now, and the only ways out are a signal and a throw.
async function start(
    root: string,
    out: string,
    port: string | undefined,
): Promise<undefined> {
    if (!existsSync(`${out}/server.ts`))
        throw new Error(
            `abide start: no build at ${out}. Run \`abide build\` first.`,
        )
    const server = await serveBuild({
        root,
        out,
        port: port === undefined ? undefined : Number(port),
    })
    console.log(`abide start: ${server.url.href}`)
    return undefined
}

const code = await main(Bun.argv.slice(2))
// A COMMAND THAT ANSWERED WITH NO CODE HAS TAKEN THE PROCESS OVER. Exiting on `0` here would
// close the socket `abide start` just bound, in the same tick it bound it.
if (code !== undefined) process.exit(code)
