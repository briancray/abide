#!/usr/bin/env bun
// The `abide` CLI. Commands are addresses, not names, so they live in one dispatch
// rather than a file each until one of them grows a reason to move.

import { existsSync, realpathSync } from 'node:fs' // bun exposes no sync existence check or realpath of its own
import { rm } from 'node:fs/promises' // bun exposes no recursive directory removal of its own
import { resolve } from 'node:path' // bun exposes no path helpers of its own
import { parseArgs } from 'node:util' // bun exposes no argv parser of its own yet
import { brotliCompress, constants } from 'node:zlib' // bun has gzip and zstd of its own, and no brotli

import { compileApp } from '#compiler/compileApp.ts'
import { scaffold } from '#compiler/scaffold.ts'
import {
    CLIENT_DIRECTORY,
    ENCODING_SUFFIX,
    MANIFEST,
    PUBLIC_DIRECTORY,
} from '#server/CLIENT_BUILD.ts'
import { chunksByModule, NO_MANIFEST } from '#server/chunksByModule.ts'
import { clientBuildOptions } from '#server/clientBuildOptions.ts'
import { appRoot, buildDirectory } from '#server/createApp.ts'
import { fenceServer } from '#server/fenceServer.ts'
import { namesUnder } from '#server/namesUnder.ts'
import { refuseAddressCollision } from '#server/refuseAddressCollision.ts'
import {
    appUrl,
    callHandler,
    remoteHeaders,
    remoteUrl,
} from '#server/remote.ts'
import { serveBuild } from '#server/serveBuild.ts'
import { serveDev } from '#server/serveDev.ts'
import {
    LOGS_ADDRESS,
    MCP_ADDRESS,
    OPENAPI_ADDRESS,
} from '#shared/ADDRESSES.ts'

// What `main` hands a command: the words after the flags, the command's own first, and the flags.
type Given = ReturnType<typeof parsed>

// Where the app a command builds or serves is, and where its build goes — both absolute.
type AppDirectories = { root: string; out: string }

// 38.13 — THE COMMAND LIST, and the help and the dispatch both read off it: a command that exists
// is a command the help names and the dispatch reaches, and there is no second place for one to go
// missing.
const COMMANDS: [
    usage: string,
    meaning: string,
    run: (given: Given) => Promise<number | undefined>,
][] = [
    ['scaffold <name>', 'write a starter project', scaffoldCommand],
    ['run <file> [args…]', 'run a script under the abide runtime', run],
    ['dev', 'serve with the compiler in the loop', inApp(dev)],
    ['build', 'compile every .abide under the app into .abide/', inApp(build)],
    ['start', 'serve a built app', inApp(start)],
    ['connect [url]', 'an interactive shell against a running app', connect],
    ['call <address> [args]', 'one call to one handler', call],
    ['openapi', 'the OpenAPI document, written rather than served', openapi],
    ['mcp', "the app's MCP server over stdio", mcp],
    [
        'logs',
        'a live subscription to log.records',
        ({ values }) => logs(values.url),
    ],
    ['check', 'not built yet', notBuilt],
    ['compile', 'not built yet', notBuilt],
    ['bundle', 'not built yet', notBuilt],
    ['lsp', 'not built yet', notBuilt],
]

async function notBuilt({ positionals }: Given): Promise<number> {
    console.error(`abide ${positionals[0]}: not built yet.`)
    return 1
}

function usage(): string {
    const width = Math.max(...COMMANDS.map(([name]) => name.length))
    let text = 'abide <command>\n\n'
    for (const [name, meaning] of COMMANDS)
        text += `  ${name.padEnd(width)}  ${meaning}\n`
    text += `
  --root   the app's source directory, the one ui/ sits under —
           src/ where you stand, or where you stand, whichever has one
  --out    where the build goes, beside the app by default; the file openapi writes
  --port   the listen port for dev and start
  --url    the running app connect, call, logs, openapi and mcp talk to
`
    return text
}

async function build({ root, out }: AppDirectories): Promise<number> {
    // `--out` is a real flag rather than a constant because two test files each building into
    // one `.abide/` is the contention CLAUDE.md's "checks" section already records once.
    const app = await compileApp(root)
    if (app.modules.size === 0) {
        console.log(`abide build: no .abide sources or handlers under ${root}`)
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
    // 36.11 — the path below the directory IS the address. `favicon.ico` answers at
    // `/favicon.ico`, and nothing declares that anywhere.
    const publicNames = namesUnder(`${root}/ui/${PUBLIC_DIRECTORY}`)
    const publicAddresses = publicNames.map((name) => `/${name}`)
    // 36.13 IS CHECKED BEFORE A BYTE IS BUNDLED OR COPIED, through `refuseAddressCollision` — which
    // `abide dev` runs too. Checking it mid-copy left a partial output behind on the throw, and it
    // left the dev lane unchecked entirely.
    refuseAddressCollision(app.routes, publicAddresses, 'abide build')
    await bundleClient(
        out,
        fenceServer(root, app.modules),
        publicAddresses,
        app.routes.length > 0,
    )
    // An app's static files are its own whether or not it has a page yet.
    const published = await copyPublic(root, out, publicNames)
    console.log(
        `abide build: ${app.sources} source(s), ${published} public file(s) -> ${out}`,
    )
    return 0
}

// 38.19 — `src/ui/public`, copied into the built output. Copied rather than left where it is, so
// `abide start` answers out of what the build produced and an app moving a file after a build
// cannot change what is served.
async function copyPublic(
    root: string,
    out: string,
    names: string[],
): Promise<number> {
    const from = `${root}/ui/${PUBLIC_DIRECTORY}`

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
// (30.11) rather than landing in the entry every page pays for. 38.5 IS THIS FUNCTION: hashed and
// minified by the bundler, the manifest off its metafile (the entry's name, and the chunks each
// route module needs for 38.29), and the precompressed copies (`precompressOne`). What the manifest
// does NOT carry yet is 38.19's list of public files.
async function bundleClient(
    out: string,
    fence: Bun.BunPlugin,
    publicAddresses: string[],
    paged: boolean,
): Promise<void> {
    // EMPTIED FIRST. `Bun.build` writes its chunks in and removes nothing, so a chunk whose content
    // hash changed leaves the old one behind and the directory is the union of every build ever run
    // into it. The docs app accumulated 1,423 orphans against 86 live chunks, and the cost is not
    // disk: a grep over the built output answers about code no page loads, which is how one
    // exploration priced the client bundle off files nothing imports.
    await rm(`${out}/${CLIENT_DIRECTORY}`, { recursive: true, force: true })
    // AN APP OF HANDLERS ALONE has no page to boot, and is served with no client — the manifest
    // written anyway, so `abide start` reads one shape whatever the app holds.
    if (!paged) {
        await Bun.write(`${out}/${MANIFEST}`, JSON.stringify(NO_MANIFEST))
        return
    }
    const built = await Bun.build({
        ...clientBuildOptions(out, [fence], publicAddresses),
        outdir: `${out}/${CLIENT_DIRECTORY}`,
        // 38.5 — MINIFIED, and EVERY NAME HASHED, the entry's included: chunks and assets are
        // already `[name]-[hash]` by default and the entry is not, which left the one file every
        // page loads served for a year under a name the next deploy writes different bytes to.
        // The manifest is how the document learns what the entry was called this time.
        //
        // NAMES KEPT, because a class's name is what an error reads to say what it was handed
        // (`canonicalKey`), and a production error naming `a e` is one nobody can act on. It is
        // free where it is paid: the JS the docs app's `/values` sends is 25.6 KB brotli with
        // the names and without, against 31.9 unminified.
        minify: {
            whitespace: true,
            syntax: true,
            identifiers: true,
            keepNames: true,
        },
        naming: { entry: '[name]-[hash].[ext]' },
    })
    // THROWN RATHER THAN LOGGED. A build that emitted server modules and no bundle is an app that
    // serves every page dead — the markup is right and nothing is wired — which is the one failure
    // a reader cannot see, so it stops the command instead.
    if (!built.success)
        throw new AggregateError(
            built.logs,
            'abide build: the client bundle failed',
        )
    // THE REAL PATH, because the metafile names a file on disk with its symlinks resolved — and an
    // `--out` under `/tmp` is `/private/tmp` to the bundler, which would key nothing at all.
    await Bun.write(
        `${out}/${MANIFEST}`,
        JSON.stringify(
            chunksByModule(
                built.metafile as Bun.BuildMetafile,
                realpathSync(out),
            ),
        ),
    )
    await Promise.all(built.outputs.map(precompressOne))
}

// 38.5 — EVERY FILE THE BUNDLE WROTE, BESIDE ITSELF IN EACH OF `ENCODING_SUFFIX`'s ENCODINGS, at
// the highest level each has. The price is paid here once, where a server compressing per request
// would pay it on every response or settle for a worse level to keep the response fast.
//
// ALL AT ONCE. The async brotli runs off the main thread, so the files compress side by side
// rather than one after another — brotli at 11 is most of what this step costs.
async function precompressOne(output: Bun.BuildArtifact): Promise<void> {
    // `arrayBuffer` AND NOT `bytes`: the artifact's type declares both and it answers only the one.
    const bytes = new Uint8Array(await output.arrayBuffer())
    const brotli = await new Promise<Uint8Array>((compressed, failed) =>
        brotliCompress(
            bytes,
            {
                params: {
                    [constants.BROTLI_PARAM_QUALITY]:
                        constants.BROTLI_MAX_QUALITY,
                    [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
                },
            },
            (thrown, result) =>
                thrown === null ? compressed(result) : failed(thrown),
        ),
    )
    await Promise.all([
        Bun.write(output.path + ENCODING_SUFFIX.br, brotli),
        Bun.write(
            output.path + ENCODING_SUFFIX.gzip,
            Bun.gzipSync(bytes, { level: 9 }),
        ),
    ])
}

async function main(argv: string[]): Promise<number | undefined> {
    // 38.2 — EVERYTHING AFTER THE FILE IS THE SCRIPT'S, flags included, so `run` is taken before the
    // parser sees an argument it does not know.
    const given: Given =
        argv[0] === 'run' ? { positionals: argv, values: {} } : parsed(argv)
    const command = given.positionals[0]
    if (command === undefined || command === 'help' || given.values.help) {
        console.log(usage())
        return 0
    }
    for (const [name, , body] of COMMANDS)
        if (name.split(' ')[0] === command) return await body(given)
    console.error(`abide: unknown command '${command}'\n\n${usage()}`)
    return 1
}

function parsed(argv: string[]) {
    return parseArgs({
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
            url: { type: 'string' },
            method: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
    })
}

// The app a command builds or serves, found once and handed over ABSOLUTE. Every consumer below
// needs the resolved form for a different reason: the checker panics on a relative tsconfig,
// `import()` of the emitted route table has no base to resolve against, and the walk slices a
// source path against the root's length.
function inApp(
    body: (app: AppDirectories, given: Given) => Promise<number | undefined>,
): (given: Given) => Promise<number | undefined> {
    return async (given) => {
        const { positionals, values } = given
        const root = appRoot(values.root)
        if (root === undefined) {
            console.error(
                `abide ${positionals[0]}: no app here. Looked for ui/ in ${process.cwd()} and in ${resolve('src')}. Point --root at the directory ui/ sits under.`,
            )
            return 1
        }
        // BESIDE THE APP RATHER THAN BESIDE THE SHELL. An app's build belongs to the app, so
        // `abide build --root packages/app/src` run from anywhere puts it in `packages/app/.abide` —
        // and `abide start --root packages/app/src` then finds it without being told twice.
        const out =
            values.out === undefined
                ? buildDirectory(root)
                : resolve(values.out)
        return await body({ root, out }, given)
    }
}

// 38.1.
async function scaffoldCommand({
    positionals: [, name],
}: Given): Promise<number> {
    if (name === undefined) {
        console.error(
            'abide scaffold: name the project — abide scaffold <name>',
        )
        return 1
    }
    const into = resolve(name)
    const { written, skipped } = await scaffold(name, into)
    for (const path of written) console.log(`  wrote   ${path}`)
    for (const path of skipped) console.log(`  kept    ${path}`)
    console.log(
        `\nabide scaffold: ${into}\n\n  cd ${name}\n  bun install\n  abide dev`,
    )
    return 0
}

// 38.2 — A SCRIPT UNDER THE ABIDE RUNTIME: the request scope installed, the configuration resolved
// against the app it stands in, and the script run in a scope of its own — so it imports `#server`
// and `#shared` and reads `config` without a build.
async function run({ positionals: [, file, ...rest] }: Given): Promise<number> {
    if (file === undefined) {
        console.error('abide run: name the file — abide run <file> [args…]')
        return 1
    }
    const path = resolve(file)
    process.argv = [process.argv[0] as string, path, ...rest]
    const { inScope } = await import('#server/requestScope.ts')
    const { CONFIG_ROOT } = await import('#server/config.ts')
    CONFIG_ROOT.current = appRoot(undefined) ?? process.cwd()
    await inScope(undefined, () => import(Bun.pathToFileURL(path).href))
    return 0
}

// 38.8.
async function call({
    positionals: [, address, args],
    values: { url, method },
}: Given): Promise<number> {
    if (address === undefined) {
        console.error(
            'abide call: name the handler — abide call invoices/getInvoice \'{"id": "4310"}\'',
        )
        return 1
    }
    const answered = await callHandler(appUrl(url), address, args, method)
    if (answered.text !== '')
        (answered.code === 0 ? console.log : console.error)(answered.text)
    return answered.code
}

// 38.7 — THE SHELL AGAINST A RUNNING APP, booting nothing: a line is a command, and `call` is the
// same spelling it is in argv (38.8).
async function connect({ positionals, values }: Given): Promise<number> {
    const url = appUrl(positionals[1] ?? values.url)
    console.log(`abide connect: ${url}\n  call <address> [args]   logs   exit`)
    process.stdout.write('> ')
    for await (const line of console) {
        const [word, address, ...rest] = line.trim().split(/\s+/)
        if (word === 'exit' || word === 'quit') break
        if (word === 'call' && address !== undefined) {
            const answered = await callHandler(
                url,
                address,
                rest.join(' ') || undefined,
                undefined,
            )
            console.log(
                answered.text === ''
                    ? `(${answered.code === 0 ? 'no content' : `exit ${answered.code}`})`
                    : answered.text,
            )
        } else if (word === 'logs') await logs(url)
        else if (word !== undefined && word !== '')
            console.log(`unknown: ${word}`)
        process.stdout.write('> ')
    }
    return 0
}

// 38.10 — every line `log.records` publishes, as it is written.
async function logs(url: string | undefined): Promise<number> {
    const answer = await fetch(`${appUrl(url)}${LOGS_ADDRESS}`, {
        headers: remoteHeaders(),
    })
    if (!answer.ok || answer.body === null) {
        console.error(
            `abide logs: the app answered ${answer.status}. ABIDE_LOGS opens the subscription.`,
        )
        return 1
    }
    let buffered = ''
    const decoder = new TextDecoder()
    for await (const chunk of answer.body) {
        buffered += decoder.decode(chunk, { stream: true })
        let at = buffered.indexOf('\n\n')
        while (at !== -1) {
            const event = buffered.slice(0, at)
            buffered = buffered.slice(at + 2)
            if (event.startsWith('data: ')) {
                const record = JSON.parse(event.slice(6)) as Record<
                    string,
                    string
                >
                console.log(
                    `${record.time} ${record.level} ${record.namespace} ${record.message}`,
                )
            }
            at = buffered.indexOf('\n\n')
        }
    }
    return 0
}

// 38.9 — A GENERATED SURFACE, asked of the app `--url` names, or of the local build booted in this
// process with that surface opened — which derives from the same route table the served one does.
async function surfaceAt(
    url: string | undefined,
    surface: string,
    address: string,
): Promise<
    (
        init?: RequestInit & { headers?: Record<string, string> },
    ) => Promise<Response>
> {
    const remote = remoteUrl(url)
    if (remote !== undefined)
        return (init) =>
            fetch(`${appUrl(remote)}${address}`, {
                ...init,
                headers: { ...init?.headers, ...remoteHeaders() },
            })
    process.env[surface] = '1'
    const { createApp } = await import('#server/createApp.ts')
    const app = await createApp()
    return (init) =>
        app.fetch(new Request(`http://abide.local${address}`, init))
}

// 38.9 — the document, from `--url` where one is given and from the local build where not.
async function openapi({ values: { url, out } }: Given): Promise<number> {
    const answer = await (
        await surfaceAt(url, 'ABIDE_OPENAPI', OPENAPI_ADDRESS)
    )()
    if (!answer.ok) {
        console.error(
            `abide openapi: the app answered ${answer.status}. ABIDE_OPENAPI opens the document.`,
        )
        return 1
    }
    const text = JSON.stringify(await answer.json(), null, 4)
    if (out === undefined) console.log(text)
    else await Bun.write(resolve(out), `${text}\n`)
    return 0
}

// 38.9, 38.14 — THE MCP SERVER OVER STDIO, a bridge a model client spawns and kills: each line in is a
// JSON-RPC message for `/__abide/mcp`, and each answer is a line out.
async function mcp({ values: { url } }: Given): Promise<number> {
    const ask = await surfaceAt(url, 'ABIDE_MCP', MCP_ADDRESS)
    for await (const line of console) {
        if (line.trim() === '') continue
        const answer = await ask({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: line,
        })
        const text = await answer.text()
        if (text !== '') process.stdout.write(`${text}\n`)
    }
    return 0
}

// 38.4 — the project, watched, with the app kept up. Hands back no exit code for `start`'s
// reason: the process IS the server.
async function dev(
    { root }: AppDirectories,
    { values: { port } }: Given,
): Promise<undefined> {
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
    { root, out }: AppDirectories,
    { values: { port } }: Given,
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
