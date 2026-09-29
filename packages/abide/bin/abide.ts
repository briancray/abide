#!/usr/bin/env bun
// The `abide` CLI: `commands.ts`'s list over the app on disk, and the commands that need the source
// and the compiler, which a compiled app's executable does not hold.

import { existsSync, realpathSync } from 'node:fs' // bun exposes no sync existence check or realpath of its own
import { rm } from 'node:fs/promises' // bun exposes no recursive directory removal of its own
import { resolve } from 'node:path' // bun exposes no path helpers of its own
import { brotliCompress, constants } from 'node:zlib' // bun has gzip and zstd of its own, and no brotli

import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import { compiledEntry } from '#compiler/compiledEntry.ts'
import { formatDiagnosis } from '#compiler/formatDiagnosis.ts'
import { scaffold } from '#compiler/scaffold.ts'
import { serveLanguage } from '#compiler/serveLanguage.ts'
import { appPlugins } from '#server/appPlugins.ts'
import {
    CLIENT_DIRECTORY,
    ENCODING_SUFFIX,
    MANIFEST,
    PUBLIC_DIRECTORY,
} from '#server/CLIENT_BUILD.ts'
import { clientBuildOptions } from '#server/clientBuildOptions.ts'
import { type Given, type Host, runCommands } from '#server/commands.ts'
import { packageUnder } from '#server/config.ts'
import {
    appRoot,
    buildDirectory,
    createApp,
    hooksModuleUnder,
    originUnder,
} from '#server/createApp.ts'
import { fenceServer } from '#server/fenceServer.ts'
import { manifestOf, NO_MANIFEST } from '#server/manifestOf.ts'
import { namesUnder } from '#server/namesUnder.ts'
import { refuseAddressCollision } from '#server/refuseAddressCollision.ts'
import { methodOnDisk } from '#server/remote.ts'
import { shellUnder } from '#server/render.ts'
import {
    handlersIn,
    loadBuild,
    pathsUnder,
    serveApp,
} from '#server/serveBuild.ts'
import { serveDev } from '#server/serveDev.ts'

/** Where the app a command builds or serves is, and where its build goes — both absolute. */
type AppDirectories = { root: string; out: string }

/**
 * `abide`'s host: the app on disk, found by `--root` (38.26), and every command that needs the
 * source and the compiler.
 */
const DISK: Host = {
    name: 'abide',
    methodOf: methodOnDisk,
    appPackage: () => packageUnder(appRoot(undefined) ?? process.cwd()),
    boot: createApp,
    serve: inApp(({ root, out }, { values: { port } }) =>
        serveApp(
            originUnder(root),
            () => loadBuild({ root, out }),
            port === undefined ? undefined : Number(port),
        ),
    ),
    source: {
        scaffold: scaffoldCommand,
        dev: inApp(dev),
        build: inApp(build),
        check: inApp(check),
        compile: inApp(compile),
        lsp,
    },
}

/** `abide build`: compiles the app, bundles its client and copies its public files into `out`. */
async function build(directories: AppDirectories): Promise<number> {
    await writeBuild(directories)
    return 0
}

/** `build`'s work; answers whether there was anything under `root` to build. */
async function writeBuild({ root, out }: AppDirectories): Promise<boolean> {
    process.env.NODE_ENV ??= 'production'
    // `--out` is a real flag rather than a constant because two test files each building into
    // one `.abide/` is the contention CLAUDE.md's "checks" section already records once.
    const app = await compileApp(root)
    for (const warning of app.warnings)
        console.warn(formatDiagnosis(warning, process.cwd()))
    if (app.modules.size === 0) {
        console.log(`abide build: no .abide sources or handlers under ${root}`)
        return false
    }
    // WRITTEN TOGETHER. 175 modules for the docs app, each independent of the others, and one
    // `await` a time made the emit a queue — the same reason `publicFilesAt` and the dev
    // worker's own reads are one `Promise.all` each.
    const writes: Promise<number>[] = []
    for (const [name, text] of app.modules)
        writes.push(Bun.write(`${out}/${name}`, text))
    await Promise.all(writes)

    // A MODULE WHOSE SOURCE IS GONE IS REMOVED, not left standing, or the output is the union of
    // every build and a grep over it answers about code no build produces — the same class as the
    // orphan chunks `bundleClient` empties, one level up.
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
        [fenceServer(root, app.modules), ...(await appPlugins(root))],
        publicAddresses,
        app.routes.length > 0,
    )
    // An app's static files are its own whether or not it has a page yet.
    const published = await copyPublic(root, out, publicNames)
    console.log(
        `abide build: ${app.sources} source(s), ${published} public file(s) -> ${out}`,
    )
    return true
}

/**
 * A plugin that loads every stylesheet a server module imports as nothing.
 *
 * A STYLESHEET A SERVER MODULE IMPORTS IS THE CLIENT BUNDLE'S. The page's markup runs on both sides
 * and imports its stylesheet for the side that paints; the server's half has nothing to apply it to,
 * and bundling it anyway resolves every `url()` in it against a filesystem the executable will not
 * have.
 */
const SERVER_STYLESHEETS: Bun.BunPlugin = {
    name: 'abide:server-stylesheets',
    setup(build) {
        build.onLoad({ filter: /\.css$/ }, () => ({
            contents: '',
            loader: 'js',
        }))
    },
}

/**
 * `abide compile`: builds the app, then one executable per target platform.
 *
 * 38.11 — THE BUILD, AND THEN ONE EXECUTABLE PER TARGET with all of it inside (`compiledEntry`).
 * `--out` is the executable rather than the build, which goes where `abide build` puts it; with no
 * `--out` the executable is the app's own name, in the directory the command was run from (38.47).
 */
async function compile(
    { root }: AppDirectories,
    { values }: Given,
): Promise<number> {
    // 38.49.
    if (values.target !== undefined && values.platforms !== undefined) {
        console.error(
            'abide compile: --target is one platform and --platforms is several; give one of them.',
        )
        return 1
    }
    const out = buildDirectory(root)
    if (!(await writeBuild({ root, out }))) {
        console.error(`abide compile: nothing under ${root} to compile.`)
        return 1
    }
    const identity = packageUnder(root)
    const handlerModules = new Map<string, string>()
    for (const { source } of await handlersIn(out))
        handlerModules.set(source, `${root}/${source}`)
    const entry = `${out}/compiled.ts`
    await Bun.write(
        entry,
        compiledEntry({
            out,
            hooks: hooksModuleUnder(root),
            package: identity,
            shell: await shellUnder(root),
            manifest: await Bun.file(`${out}/${MANIFEST}`).json(),
            handlerModules,
            client: pathsUnder(`${out}/${CLIENT_DIRECTORY}`),
            published: pathsUnder(`${out}/${PUBLIC_DIRECTORY}`),
        }),
    )

    // 38.47 — A SCOPED NAME IS NAMED BY ITS LAST PART: `@acme/ledger` is `ledger`, as `bunx`
    // calls it.
    const named = resolve(
        values.out ?? (identity.name ?? 'app').replace(/^@[^/]+\//, ''),
    )
    const platforms =
        values.platforms?.split(',') ??
        (values.target === undefined ? [undefined] : [values.target])
    for (const platform of platforms) {
        // 38.48.
        const outfile =
            values.platforms === undefined ? named : `${named}-${platform}`
        const compiled = await Bun.build({
            entrypoints: [entry],
            target: 'bun',
            plugins: [SERVER_STYLESHEETS],
            // UNMINIFIED, AND MAPPED: the executable is a server, and an error it logs is read by
            // whoever operates it — a minified line prints as the whole page module it sits in. The
            // map is embedded in the executable, which reads it from there.
            sourcemap: 'inline',
            compile: {
                ...(platform === undefined
                    ? {}
                    : { target: `bun-${platform}` as Bun.Build.CompileTarget }),
                outfile,
                // 38.46 — THE EXECUTABLE IS THE BUILD'S, not the machine's: a `bunfig.toml`
                // wherever it is started must not change what it runs. `.env` is still read, as
                // `abide start` reads it — configuration is the environment's (27.8).
                autoloadBunfig: false,
            },
        })
        if (!compiled.success)
            throw new AggregateError(
                compiled.logs,
                `abide compile: ${platform ?? 'this platform'} failed`,
            )
        // ONE FILE: bun writes the embedded map out beside the executable as well, whatever the
        // `sourcemap` mode, and nothing reads that copy.
        for (const output of compiled.outputs)
            if (output.kind === 'sourcemap')
                await rm(output.path, { force: true })
        console.log(`abide compile: ${outfile}`)
    }
    return 0
}

/**
 * Copies the app's public files into the build output, and returns how many.
 *
 * 38.19 — `src/ui/public`, copied into the built output. Copied rather than left where it is, so
 * `abide start` answers out of what the build produced and an app moving a file after a build
 * cannot change what is served.
 */
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

/**
 * Bundles the client into `out`, with its manifest and precompressed copies.
 *
 * THE BUNDLE. Which module boots the client is the compiler's knowledge — it writes the entry
 * into the output tree beside the route table — and this is where that entry becomes a browser
 * bundle.
 *
 * `--splitting`, so a destination's markup and bindings stay in the chunk its own route loads
 * (30.11) rather than landing in the entry every page pays for. 38.5 IS THIS FUNCTION: hashed and
 * minified by the bundler, the manifest off its metafile (the entry's name, and the chunks each
 * route module needs for 38.29), and the precompressed copies (`precompressOne`). What the manifest
 * does NOT carry yet is 38.19's list of public files.
 */
async function bundleClient(
    out: string,
    plugins: Bun.BunPlugin[],
    publicAddresses: string[],
    paged: boolean,
): Promise<void> {
    // EMPTIED FIRST. `Bun.build` writes its chunks in and removes nothing, so a chunk whose content
    // hash changed leaves the old one behind and the directory is the union of every build ever run
    // into it — and the cost is not disk: a grep over the built output answers about code no page
    // loads.
    await rm(`${out}/${CLIENT_DIRECTORY}`, { recursive: true, force: true })
    // AN APP OF HANDLERS ALONE has no page to boot, and is served with no client — the manifest
    // written anyway, so `abide start` reads one shape whatever the app holds.
    if (!paged) {
        await Bun.write(`${out}/${MANIFEST}`, JSON.stringify(NO_MANIFEST))
        return
    }
    const built = await Bun.build({
        ...clientBuildOptions(out, plugins, publicAddresses),
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
            manifestOf(built.metafile as Bun.BuildMetafile, realpathSync(out)),
        ),
    )
    await Promise.all(built.outputs.map(precompressOne))
}

/**
 * Writes brotli and gzip copies of one bundle output beside it.
 *
 * 38.5 — EVERY FILE THE BUNDLE WROTE, BESIDE ITSELF IN EACH OF `ENCODING_SUFFIX`'s ENCODINGS, at
 * the highest level each has. The price is paid here once, where a server compressing per request
 * would pay it on every response or settle for a worse level to keep the response fast.
 *
 * ALL AT ONCE. The async brotli runs off the main thread, so the files compress side by side
 * rather than one after another — brotli at 11 is most of what this step costs.
 */
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

/**
 * Wraps a command body with the app's absolute root and build directory, or fails with no app.
 *
 * The app a command builds or serves, found once and handed over ABSOLUTE. Every consumer below
 * needs the resolved form for a different reason: the checker panics on a relative tsconfig,
 * `import()` of the emitted route table has no base to resolve against, and the walk slices a
 * source path against the root's length.
 */
function inApp<Answer>(
    body: (app: AppDirectories, given: Given) => Promise<Answer>,
): (given: Given) => Promise<Answer | number> {
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

/**
 * `abide scaffold <name>`: writes a new project.
 *
 * 38.1.
 */
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

/**
 * `abide check`: prints every finding, and fails on any error.
 *
 * 38.3 — every finding under the app, or under the directories named; a failure where any is an
 * error, and a success where the findings are warnings alone.
 */
async function check(
    { root }: AppDirectories,
    { positionals }: Given,
): Promise<number> {
    const within: string[] = []
    for (const directory of positionals.slice(1))
        within.push(
            existsSync(directory)
                ? realpathSync(resolve(directory))
                : resolve(directory),
        )
    const found = await checkApp(root)
    let errors = 0
    let warnings = 0
    for (const diagnosis of found) {
        if (
            within.length > 0 &&
            !within.some(
                (directory) =>
                    diagnosis.path === directory ||
                    diagnosis.path.startsWith(`${directory}/`),
            )
        )
            continue
        if (diagnosis.category === 'error') errors += 1
        else if (diagnosis.category === 'warning') warnings += 1
        else continue
        console.log(formatDiagnosis(diagnosis, process.cwd()))
    }
    console.log(
        `abide check: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`,
    )
    return errors > 0 ? 1 : 0
}

/**
 * `abide lsp`: the language server over stdio.
 *
 * 38.12 — the language server, for as long as the editor holds stdin open. Nothing is printed: stdout
 * is the protocol.
 *
 * Not `inApp`: an editor starts it wherever its workspace is, and each document finds its own app.
 */
async function lsp({ values }: Given): Promise<number> {
    const root = values.root === undefined ? undefined : resolve(values.root)
    await serveLanguage(root, Bun.stdin.stream(), (bytes) => {
        process.stdout.write(bytes)
    })
    return 0
}

/**
 * `abide dev`: serves the app and rebuilds it as it changes.
 *
 * 38.4 — the project, watched, with the app kept up. Hands back no exit code for `start`'s
 * reason: the process IS the server.
 *
 * 36.3 — `dev`, `build` and `start` each name the environment where the process was started with
 * none, and leave one it was started with exactly as given.
 */
async function dev(
    { root }: AppDirectories,
    { values: { port } }: Given,
): Promise<undefined> {
    process.env.NODE_ENV ??= 'development'
    const server = await serveDev({
        root,
        port: port === undefined ? undefined : Number(port),
    })
    console.log(`abide dev: ${server.url.href}`)
    return undefined
}

const code = await runCommands(DISK, Bun.argv.slice(2))
if (code !== undefined) process.exit(code)
