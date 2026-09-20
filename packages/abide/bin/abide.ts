#!/usr/bin/env bun
// The `abide` CLI. Commands are addresses, not names, so they live in one dispatch
// rather than a file each until one of them grows a reason to move.

import { existsSync } from 'node:fs' // bun exposes no sync existence check of its own
import { dirname, resolve } from 'node:path' // bun exposes no path helpers of its own
import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet

import type { AbideFile } from '#compiler'
import {
    emitClient,
    emitComponent,
    invokedComponents,
    parseAbide,
} from '#compiler'
import { ROUTING_SPECIFIER } from '#compiler/SPECIFIERS.ts'
import { TypeSession } from '#compiler/TypeSession.ts'
import {
    CLIENT_DIRECTORY,
    CLIENT_ENTRY,
    PUBLIC_DIRECTORY,
} from '#server/CLIENT_BUILD.ts'
import { serveBuild } from '#server/serveBuild.ts'
import { routeOf } from '#shared/routePattern.ts'

const USAGE = `abide <command>

  build    compile every .abide under the app into .abide/ (--out to change)
  start    serve a built app (--port to choose the socket)
  dev      serve with the compiler in the loop

  --root   the app's source directory, the one ui/ sits under
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
    let published = 0
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
        const reads = await session?.readsFor(parsed)

        // 32.19 — WHICH FILES ARE INVOKED AS COMPONENTS. A caller's client module imports its
        // child's, so a child with nothing to hydrate still needs one to exist (the no-op below),
        // and only a child carries its own markup (`emitClient`).
        const invoked = invokedComponents(parsed.map((entry) => entry.text))

        // 30.7 — A ROUTABLE PAGE CARRIES ITS OWN MARKUP for the same reason an invoked component
        // does, and it is the same mechanism: a page the reader ARRIVED at was painted by the
        // server and hydrates, and a page they NAVIGATED to is handed the empty anchor pair and
        // fills it from the template in its own module. `emitClient`'s `isEmptyRegion` guard is
        // what makes one module serve both, so "routable" joins "invoked" rather than forking it.
        const routes: { pattern: string; source: string }[] = []
        for (const entry of parsed) {
            const relative = entry.path.slice(root.length + 1)
            if (!isPage(relative)) continue
            routes.push({ pattern: routeOf(relative), source: relative })
        }
        for (let at = 0; at < parsed.length; at += 1) {
            const entry = parsed[at] as (typeof parsed)[number]
            const relative = entry.path.slice(root.length + 1)
            const fileReads = reads?.[at]
            await Bun.write(
                `${out}/${relative.replace(/\.abide$/, '.ts')}`,
                emitComponent(entry.file, fileReads),
            )

            // The client module is emitted only where there is something to hydrate. A static
            // page has no `.client.ts` beside it, which is what makes "this page ships no
            // runtime" a fact about the build rather than a claim about the bundler.
            //
            // A COMPONENT SOMEBODY INVOKES IS THE EXCEPTION, and it is the import that forces it:
            // the caller's client module names the child's, so a child with nothing to hydrate
            // needs a module for that name to resolve to. The no-op is what it ships.
            const name = relative.slice(relative.lastIndexOf('/') + 1)
            const client = emitClient(
                entry.file,
                fileReads,
                invoked.has(name) || isPage(relative),
            )
            if (client !== '' || invoked.has(name))
                await Bun.write(
                    `${out}/${relative.replace(/\.abide$/, '.client.ts')}`,
                    client === '' ? 'export default () => {}\n' : client,
                )
        }
        // THE ROUTE TABLE, as the build's own knowledge rather than a list an app maintains. Which
        // addresses exist is a fact about the file tree (`page.abide` is an address, CLAUDE.md),
        // so a route that is not a directory cannot be written and a directory that is one cannot
        // be forgotten. The loaders are dynamic imports, which is what keeps a destination's
        // markup and bindings off the entry page's bundle until somebody navigates there.
        //
        // TWO TABLES OFF ONE WALK. The client's loads the `.client.ts` that mounts a page and the
        // server's loads the `.ts` that paints it — the same addresses either way, which is what
        // keeps the pair from being two walks that can disagree. A build with no page writes
        // neither, and `abide start` then has nothing to answer and says so.
        if (routes.length > 0) {
            await writeRoutes(out, routes)
            await writeServerRoutes(out, routes)
            await writeClientBundle(out)
        }
        // OUTSIDE THE ROUTE GUARD. An app's static files are its own whether or not it has a page
        // yet, and 36.13's check needs the routes rather than the other way round.
        published = await copyPublic(root, out, routes)
    } finally {
        session?.close()
    }
    console.log(
        `abide build: ${sources.length} source(s), ${published} public file(s) -> ${out}`,
    )
    return 0
}

// `page.abide` under a `pages/` directory. Both halves are load-bearing: the name is the address
// and the directory is what says the address is a ROUTE rather than a component filed anywhere.
function isPage(relative: string): boolean {
    return (
        relative.endsWith('page.abide') &&
        (relative.startsWith('pages/') || relative.includes('/pages/'))
    )
}

type Route = { pattern: string; source: string }

// One row of either table. The two differ only in which module a pattern loads, so the row is
// written once and the extension is the argument.
function tableOf(routes: Route[], extension: string): string {
    const rows: string[] = []
    for (const route of routes) {
        const module = `./${route.source.replace(/\.abide$/, extension)}`
        rows.push(
            `    { pattern: ${JSON.stringify(route.pattern)}, load: () => import(${JSON.stringify(module)}) },`,
        )
    }
    return rows.join('\n')
}

async function writeRoutes(out: string, routes: Route[]): Promise<void> {
    const table = tableOf(routes, '.client.ts')
    // `host: Element` IS NOT DECORATION. This is a `.ts` file an app bundles, so an app whose own
    // tsconfig includes its build output typechecks it — and a bare `host` is an implicit `any`
    // that fails `tsc` under the `strict` every abide app is written against.
    await Bun.write(
        `${out}/routes.ts`,
        `// Written by \`abide build\`. The addresses this app answers, and what to load for each.
import { listenForRoutes, startRouter } from '${ROUTING_SPECIFIER}'

export const routes = [
${table}
]

// The router this document gets, the page it arrived on, and the two places a reader navigates
// from (30.7). Hydrating here rather than leaving it to the app is what makes the page the server
// painted live without anybody wiring it.
export function start(host: Element) {
    const router = startRouter(routes, host)
    listenForRoutes(router)
    const ready = router.hydrate()
    return { router, ready }
}
`,
    )
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
    routes: Route[],
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

// The same addresses, loading the module that PAINTS a page rather than the one that mounts it.
// No `start` here and nothing imported: `serveBuild` is the only reader, it holds the matching
// and the ranking already, and a server table that carried either would be a second copy of both.
async function writeServerRoutes(out: string, routes: Route[]): Promise<void> {
    await Bun.write(
        `${out}/server.ts`,
        `// Written by \`abide build\`. The addresses this app answers, and what paints each.
export const routes = [
${tableOf(routes, '.ts')}
]
`,
    )
}

// THE ENTRY, AND THE BUNDLE. An app does not write either: which module boots the client is the
// build's knowledge, exactly as the route table is, and a hand-written entry is one more file to
// keep in step with a layout that moves.
//
// `--splitting`, so a destination's markup and bindings stay in the chunk its own route loads
// (30.11) rather than landing in the entry every page pays for. NOT CONTENT-HASHED and with no
// manifest — that is 38.5 and it is not written yet, which makes this the shape rather than the
// guarantee.
async function writeClientBundle(out: string): Promise<void> {
    const entry = `${out}/${CLIENT_ENTRY}.ts`
    await Bun.write(
        entry,
        `// Written by \`abide build\`. What boots this app in a browser.
import { start } from './routes.ts'

start(document.body)
`,
    )
    const built = await Bun.build({
        entrypoints: [entry],
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
