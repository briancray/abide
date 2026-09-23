#!/usr/bin/env bun
// The `abide` CLI. Commands are addresses, not names, so they live in one dispatch
// rather than a file each until one of them grows a reason to move.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { rm } from 'node:fs/promises' // bun exposes no recursive directory removal of its own
import { dirname, resolve } from 'node:path' // bun exposes no path helpers of its own
import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet

import { type AppRoute, compileApp } from '#compiler/compileApp.ts'
import {
    CLIENT_DIRECTORY,
    CLIENT_ENTRY,
    PUBLIC_DIRECTORY,
} from '#server/CLIENT_BUILD.ts'
import { refuseAddressCollision } from '#server/refuseAddressCollision.ts'
import { serveBuild } from '#server/serveBuild.ts'
import { serveDev } from '#server/serveDev.ts'

const USAGE = `abide <command>

  build    compile every .abide under the app into .abide/ (--out to change)
  start    serve a built app (--port to choose the socket)
  dev      serve with the compiler in the loop

  --root   the app's source directory, the one ui/ sits under —
           src/ where you stand, or where you stand, whichever has one
  --out    where the build goes, beside the app by default
`

async function build(root: string, out: string): Promise<number> {
    // `--out` is a real flag rather than a constant because two test files each building into
    // one `.abide/` is the contention CLAUDE.md's "checks" section already records once.
    const app = await compileApp(root)
    if (app.sources === 0) {
        console.log(`abide build: no .abide sources under ${root}`)
        return 0
    }
    // WRITTEN TOGETHER. 175 modules for the docs app, each independent of the others, and one
    // `await` a time made the emit a queue — the same reason `publicFilesUnder` and the dev
    // worker's own reads are one `Promise.all` each.
    const writes: Promise<number>[] = []
    for (const [name, text] of app.modules)
        writes.push(Bun.write(`${out}/${name}`, text))
    await Promise.all(writes)

    // A MODULE WHOSE SOURCE IS GONE IS REMOVED, not left standing. Nothing removed what a DELETED
    // `.abide` used to compile to, so the output was the union of every build: a `DocsRail.ts`
    // outlived its source by a day here, and a grep over the emitted modules answered about code
    // no build produces — which is how a coverage count came back wrong. The same class as the
    // orphan chunks `bundleClient` empties, one level up and found the same way.
    //
    // PRUNED AGAINST WHAT WAS JUST WRITTEN rather than by emptying `out`: the directory is named
    // by `--out` and a flag that deletes a tree is a different kind of thing from one that writes
    // into it. `client/` holds `.js` and is emptied where it is built.
    const stale: Promise<void>[] = []
    for (const path of new Bun.Glob('**/*.ts').scanSync({ cwd: out }))
        if (!app.modules.has(path)) stale.push(rm(`${out}/${path}`))
    await Promise.all(stale)
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
// 36.13 IS CHECKED BEFORE A BYTE IS COPIED, through `refuseAddressCollision` — which `abide dev`
// runs too. Checking it here mid-copy left a partial output behind on the throw, and it left the
// dev lane unchecked entirely.
async function copyPublic(
    root: string,
    out: string,
    routes: AppRoute[],
): Promise<number> {
    const from = `${root}/ui/${PUBLIC_DIRECTORY}`
    if (!existsSync(from)) return 0

    const patterns: string[] = []
    for (const route of routes) patterns.push(route.pattern)
    const names = [...new Bun.Glob('**/*').scanSync({ cwd: from })]
    // 36.11 — the path below the directory IS the address. `favicon.ico` answers at
    // `/favicon.ico`, and nothing declares that anywhere.
    const addresses = names.map((name) => `/${name}`)
    refuseAddressCollision(patterns, addresses, 'abide build')

    const copies: Promise<number>[] = []
    // 36.12 — the bytes as authored. `Bun.write` of a `BunFile` is a copy and not a re-encode.
    for (const name of names)
        copies.push(
            Bun.write(
                `${out}/${PUBLIC_DIRECTORY}/${name}`,
                Bun.file(`${from}/${name}`),
            ),
        )
    await Promise.all(copies)
    return names.length
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
    // EMPTIED FIRST. `Bun.build` writes its chunks in and removes nothing, so a chunk whose content
    // hash changed leaves the old one behind and the directory is the union of every build ever run
    // into it. The docs app accumulated 1,423 orphans against 86 live chunks, and the cost is not
    // disk: a grep over the built output answers about code no page loads, which is how one
    // exploration priced the client bundle off files nothing imports.
    await rm(`${out}/${CLIENT_DIRECTORY}`, { recursive: true, force: true })
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
            // NO DEFAULT HERE EITHER. `cd ledger && abide dev` is what the docs tell an author to
            // type and `--root ./src` is what an app's own scripts write, so which directory is
            // meant is a question `appRoot` answers rather than one the parser assumes.
            root: { type: 'string' },
            out: { type: 'string' },
            // NO DEFAULT, which is not an omission: `Bun.serve` given no port already reads
            // `PORT` and then falls back to 3000, and a default written here would take that
            // away from every host that sets it.
            port: { type: 'string' },
        },
        allowPositionals: true,
    })
    const command = positionals[0]
    if (command === undefined || command === 'help') {
        console.log(USAGE)
        return 0
    }
    if (command !== 'build' && command !== 'start' && command !== 'dev') {
        console.error(`abide: unknown command '${command}'\n\n${USAGE}`)
        return 1
    }

    // ABSOLUTE, ONCE, HERE. Every consumer below needs the resolved form for a different reason:
    // the checker panics on a relative tsconfig, `import()` of the emitted route table has no
    // base to resolve against, and the walk slices a source path against the root's length.
    const root = appRoot(values.root)
    if (root === undefined) {
        console.error(
            `abide ${command}: no app here. Looked for ui/ in ${process.cwd()} and in ${resolve('src')}. Point --root at the directory ui/ sits under.`,
        )
        return 1
    }
    // BESIDE THE APP RATHER THAN BESIDE THE SHELL. An app's build belongs to the app, so
    // `abide build --root packages/app/src` run from anywhere puts it in `packages/app/.abide` —
    // and `abide start --root packages/app/src` then finds it without being told twice.
    const out =
        values.out === undefined
            ? `${dirname(root)}/.abide`
            : resolve(values.out)

    switch (command) {
        case 'build':
            return await build(root, out)
        case 'start':
            return await start(root, out, values.port)
        default:
            return await dev(root, values.port)
    }
}

// THE DIRECTORY `ui/` SITS UNDER. Given, or found in the two places it can be: `cd ledger &&
// abide dev` is the flow the docs teach and `--root ./src` is what an app's own scripts write,
// so a command run from an app's own directory has to mean the same thing either way.
//
// `undefined` IS A REFUSAL AND NOT A GUESS. Defaulting to the working directory is what made
// `abide dev` at a repo root compile every `.abide` in every package against a package.json with
// no seams in it — eighty-five pages that could not resolve their own imports, a bundle that
// failed, and a 500 at every address rather than a sentence saying there is no app here.
function appRoot(given: string | undefined): string | undefined {
    if (given !== undefined) return resolve(given)
    const here = process.cwd()
    if (existsSync(`${here}/ui`)) return here
    const under = resolve('src')
    return existsSync(`${under}/ui`) ? under : undefined
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
