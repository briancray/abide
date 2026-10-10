#!/usr/bin/env bun
// The `abide` CLI: `commands.ts`'s list over the app on disk, and the commands that need the source
// and the compiler, which a compiled app's executable does not hold.

import { existsSync, realpathSync } from 'node:fs' // bun exposes no sync existence check or realpath of its own
import { mkdir, rename, rm } from 'node:fs/promises' // bun exposes no directory creation, rename or recursive directory removal of its own
import { dirname, resolve } from 'node:path' // bun exposes no path helpers of its own
import { brotliCompress, constants } from 'node:zlib' // bun has gzip and zstd of its own, and no brotli

import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import { compiledEntry } from '#compiler/compiledEntry.ts'
import { formatDiagnosis } from '#compiler/formatDiagnosis.ts'
import { scaffold } from '#compiler/scaffold.ts'
import { serveLanguage } from '#compiler/serveLanguage.ts'
import { appPlugins } from '#server/appPlugins.ts'
import { banner } from '#server/banner.ts'
import { buildDirectory } from '#server/buildDirectory.ts'
import {
    CLIENT_DIRECTORY,
    ENCODING_SUFFIX,
    MANIFEST,
    PUBLIC_DIRECTORY,
} from '#server/CLIENT_BUILD.ts'
import {
    clientBuildOptions,
    stylesheetUnderMount,
} from '#server/clientBuildOptions.ts'
import { type Given, type Host, runCommands } from '#server/commands.ts'
import { componentImports } from '#server/componentImports.ts'
import { type AppPackage, packageUnder } from '#server/config.ts'
import {
    appRoot,
    createApp,
    hooksModuleUnder,
    originUnder,
} from '#server/createApp.ts'
import { fenceServer } from '#server/fenceServer.ts'
import { launcherOptionsUnder } from '#server/launcherOptions.ts'
import { manifestOf, NO_MANIFEST } from '#server/manifestOf.ts'
import { namesUnder } from '#server/namesUnder.ts'
import { refuseAddressCollision } from '#server/refuseAddressCollision.ts'
import { shellUnder } from '#server/render.ts'
import {
    handlersIn,
    loadBuild,
    pathsUnder,
    serveApp,
} from '#server/serveBuild.ts'
import { serveDev } from '#server/serveDev.ts'
import { escapeText } from '#shared/escapeText.ts'

/** Where the app a command builds or serves is, and where its build goes — both absolute. */
type AppDirectories = { root: string; out: string }

/**
 * `abide`'s host: the app on disk, found by `--root` (38.26), and every command that needs the
 * source and the compiler.
 */
const DISK: Host = {
    name: 'abide',
    handlers: async ({ values }) => {
        const app = directoriesOf(values)
        return app !== undefined && existsSync(`${app.out}/rpc.ts`)
            ? await handlersIn(app.out)
            : []
    },
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
        bundle: inApp(bundle),
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
    // 38.67 — what this build may remove is only what was written before it began.
    const began = Date.now()
    // `--out` is a real flag rather than a constant because two test files each building into
    // one `.abide/` is the contention CLAUDE.md's "checks" section already records once.
    const app = await compileApp(root, out)
    for (const warning of app.warnings)
        console.warn(formatDiagnosis(warning, process.cwd()))
    if (app.modules.size === 0) {
        console.log(`abide build: no .abide sources or handlers under ${root}`)
        return false
    }
    // WRITTEN TOGETHER. 175 modules for the docs app, each independent of the others, and one
    // `await` a time made the emit a queue — the same reason `publicFilesAt` and the dev
    // worker's own reads are one `Promise.all` each.
    const writes: Promise<void>[] = []
    for (const [name, text] of app.modules)
        writes.push(writeWhole(`${out}/${name}`, text))
    await Promise.all(writes)

    // A MODULE WHOSE SOURCE IS GONE IS REMOVED, not left standing, or the output is the union of
    // every build and a grep over it answers about code no build produces — the same class as the
    // orphan chunks `bundleClient` prunes, one level up.
    //
    // PRUNED AGAINST WHAT WAS JUST WRITTEN rather than by emptying `out`: the directory is named
    // by `--out` and a flag that deletes a tree is a different kind of thing from one that writes
    // into it. `client/` holds `.js` and is pruned where it is built.
    await pruneStale(out, '**/*.ts', app.modules, began)
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
        began,
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
    const entry = await writtenEntry(root, undefined)
    if (entry === undefined) {
        console.error(`abide compile: nothing under ${root} to compile.`)
        return 1
    }
    const named = resolve(values.out ?? executableName(root))
    const platforms =
        values.platforms?.split(',') ??
        (values.target === undefined ? [undefined] : [values.target])
    for (const platform of platforms) {
        // 38.48.
        const outfile =
            values.platforms === undefined ? named : `${named}-${platform}`
        await compileExecutable(root, entry, platform, outfile)
        console.log(`abide compile: ${outfile}`)
    }
    return 0
}

/**
 * `abide bundle`: builds the app, then a desktop app for this platform around its executable.
 *
 * 38.11, 38.71 — `compile`'s executable, started from `runDesktop`, inside a `.app` named after the
 * app where the command was run, or at `--out`.
 */
async function bundle(
    { root }: AppDirectories,
    { values }: Given,
): Promise<number> {
    // 38.78.
    if (process.platform !== 'darwin') {
        console.error(
            `abide bundle: a desktop app is built for macOS, and this is ${process.platform}. \`abide compile\` builds an executable for any platform.`,
        )
        return 1
    }
    const out = resolve(values.out ?? `${executableName(root)}.app`)
    if (!out.endsWith('.app')) {
        console.error(
            `abide bundle: --out names the .app to write, and ${out} is not one.`,
        )
        return 1
    }
    // 38.81 — REFUSED BEFORE ANYTHING IS BUILT, so a mistyped key costs no build.
    const options = await launcherOptionsUnder(root)
    if (typeof options === 'string') {
        console.error(`abide bundle: ${options}.`)
        return 1
    }
    const entry = await writtenEntry(root, async (out) => {
        const launch = `${root}/bundle/launch.abide`
        return {
            options,
            launch: (await Bun.file(launch).exists()) ? launch : undefined,
            shell: await launchShell(root, out),
        }
    })
    if (entry === undefined) {
        console.error(`abide bundle: nothing under ${root} to bundle.`)
        return 1
    }
    const identity = packageUnder(root)
    const name = executableName(root)
    await compileExecutable(
        root,
        entry,
        undefined,
        `${out}/Contents/MacOS/${name}`,
    )
    const icon = await writeIcon(root, `${out}/Contents/Resources`)
    await Bun.write(
        `${out}/Contents/Info.plist`,
        infoPlist(name, options.name ?? name, identity, icon),
    )
    // AD-HOC SIGNED, WHOLE: the executable bun wrote is signed on its own, and a bundle around a
    // signed executable that is not itself signed is one Gatekeeper reads as damaged.
    if ((await spawnedTool('codesign', ['--force', '--sign', '-', out])) !== 0)
        return 1
    console.log(`abide bundle: ${out}`)
    return 0
}

// 38.47 — A SCOPED NAME IS NAMED BY ITS LAST PART: `@acme/ledger` is `ledger`, as `bunx` calls it.
function executableName(root: string): string {
    return (packageUnder(root).name ?? 'app').replace(/^@[^/]+\//, '')
}

/**
 * Builds the app and writes the entry an executable starts from; `undefined` where there is no app.
 *
 * `desktop` is `bundle`'s, read once the build it reads from exists.
 */
async function writtenEntry(
    root: string,
    desktop:
        | ((
              out: string,
          ) => Promise<Parameters<typeof compiledEntry>[0]['desktop']>)
        | undefined,
): Promise<string | undefined> {
    const out = buildDirectory(root)
    if (!(await writeBuild({ root, out }))) return undefined
    const handlerModules = new Map<string, string>()
    for (const { source } of await handlersIn(out))
        handlerModules.set(source, `${root}/${source}`)
    const entry = `${out}/compiled.ts`
    await Bun.write(
        entry,
        compiledEntry({
            desktop: await desktop?.(out),
            out,
            hooks: hooksModuleUnder(root),
            package: packageUnder(root),
            shell: await shellUnder(root),
            manifest: await Bun.file(`${out}/${MANIFEST}`).json(),
            handlerModules,
            client: pathsUnder(`${out}/${CLIENT_DIRECTORY}`),
            published: pathsUnder(`${out}/${PUBLIC_DIRECTORY}`),
        }),
    )
    return entry
}

/** One executable from `entry`, for `platform` or this one, written to `outfile`. */
async function compileExecutable(
    root: string,
    entry: string,
    platform: string | undefined,
    outfile: string,
): Promise<void> {
    const compiled = await Bun.build({
        entrypoints: [entry],
        target: 'bun',
        // 35.4 — a handler's `.abide` import, as `abide start` lands it.
        plugins: [
            SERVER_STYLESHEETS,
            componentImports(root, buildDirectory(root)),
        ],
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
            `abide: the executable for ${platform ?? 'this platform'} failed`,
        )
    // ONE FILE: bun writes the embedded map out beside the executable as well, whatever the
    // `sourcemap` mode, and nothing reads that copy.
    for (const output of compiled.outputs)
        if (output.kind === 'sourcemap') await rm(output.path, { force: true })
}

/**
 * The document `src/bundle/launch.abide` renders into: `src/bundle/launch.html`, or a bare one.
 *
 * 38.85 — THE PAGE'S OWN `<style>` IS IN ITS HEAD. A component's stylesheet reaches a browser with
 * its client module, and a launch page has none: it is rendered before the app it would load from
 * is served.
 */
async function launchShell(root: string, out: string): Promise<string> {
    const given = Bun.file(`${root}/bundle/launch.html`)
    const document = (await given.exists())
        ? await given.text()
        : '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body></body>\n</html>\n'
    const sheet = Bun.file(`${out}/bundle/launch.style.css`)
    if (!(await sheet.exists())) return document
    const style = `<style>\n${await sheet.text()}</style>\n`
    const headEnd = document.search(/<\/head>/i)
    return headEnd === -1
        ? `${style}${document}`
        : `${document.slice(0, headEnd)}${style}${document.slice(headEnd)}`
}

/**
 * Writes the bundle's icon from `src/bundle/`, and answers whether there was one.
 *
 * 38.80 — `icon.icns` as it is, or `icon.png` drawn at every size an `.icns` holds.
 */
async function writeIcon(root: string, resources: string): Promise<boolean> {
    const icns = Bun.file(`${root}/bundle/icon.icns`)
    if (await icns.exists()) {
        await Bun.write(`${resources}/icon.icns`, icns)
        return true
    }
    const png = `${root}/bundle/icon.png`
    if (!(await Bun.file(png).exists())) return false
    const iconset = `${buildDirectory(root)}/icon.iconset`
    await rm(iconset, { recursive: true, force: true })
    await mkdir(iconset, { recursive: true })
    await mkdir(resources, { recursive: true })
    const drawn: Promise<number>[] = []
    for (const size of [16, 32, 128, 256, 512])
        for (const scale of [1, 2])
            drawn.push(
                spawnedTool('sips', [
                    '-z',
                    String(size * scale),
                    String(size * scale),
                    png,
                    '--out',
                    `${iconset}/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`,
                ]),
            )
    if ((await Promise.all(drawn)).some((code) => code !== 0)) return false
    return (
        (await spawnedTool('iconutil', [
            '-c',
            'icns',
            iconset,
            '-o',
            `${resources}/icon.icns`,
        ])) === 0
    )
}

/** Runs one of macOS's own tools, warning with what it wrote where it fails; answers its exit code. */
async function spawnedTool(tool: string, args: string[]): Promise<number> {
    const child = Bun.spawn([tool, ...args], {
        stdout: 'ignore',
        stderr: 'pipe',
    })
    const code = await child.exited
    if (code !== 0)
        console.warn(
            `abide bundle: ${tool} failed — ${(await new Response(child.stderr).text()).trim()}`,
        )
    return code
}

/** The `Info.plist` a bundle names its executable, its identity and its icon in. */
function infoPlist(
    name: string,
    displayName: string,
    identity: AppPackage,
    icon: boolean,
): string {
    const entries: [string, string][] = [
        ...(icon
            ? ([['CFBundleIconFile', '<string>icon</string>']] as [
                  string,
                  string,
              ][])
            : []),
        ['CFBundleExecutable', `<string>${name}</string>`],
        [
            'CFBundleIdentifier',
            `<string>abide.app.${name.replace(/[^A-Za-z0-9.-]/g, '-')}</string>`,
        ],
        ['CFBundleName', `<string>${escapeText(displayName)}</string>`],
        ['CFBundleDisplayName', `<string>${escapeText(displayName)}</string>`],
        ['CFBundlePackageType', '<string>APPL</string>'],
        [
            'CFBundleShortVersionString',
            `<string>${identity.version ?? '0.0.0'}</string>`,
        ],
        ['CFBundleVersion', `<string>${identity.version ?? '0.0.0'}</string>`],
        ['LSMinimumSystemVersion', '<string>13.0</string>'],
        ['NSHighResolutionCapable', '<true/>'],
        ['NSPrincipalClass', '<string>NSApplication</string>'],
        // 38.72 — the app served on loopback over http, and one connected to wherever it runs.
        [
            'NSAppTransportSecurity',
            '<dict><key>NSAllowsArbitraryLoads</key><true/></dict>',
        ],
    ]
    let body = ''
    for (const [key, value] of entries)
        body += `    <key>${key}</key>\n    ${value}\n`
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}</dict>
</plist>
`
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

    const copies: Promise<void>[] = []
    // 36.12 — the bytes as authored. `Bun.write` of a `BunFile` is a copy and not a re-encode.
    for (const name of names)
        copies.push(
            writeWhole(
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
    began: number,
): Promise<void> {
    const client = `${out}/${CLIENT_DIRECTORY}`
    // AN APP OF HANDLERS ALONE has no page to boot, and is served with no client — the manifest
    // written anyway, so `abide start` reads one shape whatever the app holds.
    if (!paged) {
        await pruneStale(client, '**/*', new Set(), began)
        await writeWhole(`${out}/${MANIFEST}`, JSON.stringify(NO_MANIFEST))
        return
    }
    // 38.67 — STAGED, THEN MOVED IN FILE BY FILE. `Bun.build` writes in place, so a second build
    // into the same `out` — or `abide start` serving it — read a chunk half written, and emptying
    // `client/` first took the one it was serving away. Every name but the manifest's is a hash of
    // what it holds, so two builds of one tree move in the same bytes under the same names.
    const staging = `${out}/.staging-${crypto.randomUUID()}`
    try {
        const built = await Bun.build({
            ...clientBuildOptions(out, plugins, publicAddresses),
            outdir: staging,
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
        await Promise.all(built.outputs.map(precompressOne))
        const produced = new Set<string>()
        const moves: Promise<void>[] = []
        for (const name of namesUnder(staging)) {
            produced.add(name)
            moves.push(
                mkdir(dirname(`${client}/${name}`), { recursive: true }).then(
                    () => rename(`${staging}/${name}`, `${client}/${name}`),
                ),
            )
        }
        await Promise.all(moves)
        await pruneStale(client, '**/*', produced, began)
        // THE REAL PATH, because the metafile names a file on disk with its symlinks resolved — and an
        // `--out` under `/tmp` is `/private/tmp` to the bundler, which would key nothing at all.
        await writeWhole(
            `${out}/${MANIFEST}`,
            JSON.stringify(
                manifestOf(
                    built.metafile as Bun.BuildMetafile,
                    realpathSync(out),
                ),
            ),
        )
    } finally {
        await rm(staging, { recursive: true, force: true })
    }
}

/**
 * Removes from `directory` what this build did not produce.
 *
 * A CHUNK WHOSE HASH CHANGED leaves the old one behind otherwise, and the directory is the union of
 * every build ever run into it — and the cost is not disk: a grep over the built output answers about
 * code no page loads. 38.67 — only what was written before this build began: anything newer is a
 * concurrent build's, and its manifest may name it.
 */
async function pruneStale(
    directory: string,
    pattern: string,
    produced: { has(name: string): boolean },
    began: number,
): Promise<void> {
    const stale: Promise<void>[] = []
    // A file gone since the scan reads as last written in the far future, and is left alone.
    for (const name of namesUnder(directory, pattern))
        if (
            !produced.has(name) &&
            Bun.file(`${directory}/${name}`).lastModified < began
        )
            stale.push(rm(`${directory}/${name}`, { force: true }))
    await Promise.all(stale)
}

/**
 * Writes `path` whole: to a name of its own beside it, then renamed over it.
 *
 * 38.67 — a reader, or a second build, finds the last complete file there and never a partial one.
 */
async function writeWhole(path: string, content: string | Blob): Promise<void> {
    const partial = `${path}.${crypto.randomUUID()}.partial`
    await Bun.write(partial, content)
    await rename(partial, path)
}

/**
 * Writes brotli and gzip copies of one bundle output beside it — a stylesheet's addresses written
 * relative to the bundle first (`stylesheetUnderMount`).
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
    let bytes = new Uint8Array(await output.arrayBuffer())
    // A stylesheet is rewritten on disk before it is compressed, so all three copies carry it.
    if (output.path.endsWith('.css')) {
        bytes = new TextEncoder().encode(
            stylesheetUnderMount(new TextDecoder().decode(bytes)),
        )
        await Bun.write(output.path, bytes)
    }
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
        const app = directoriesOf(given.values)
        if (app === undefined) {
            console.error(
                `abide ${given.positionals[0]}: no app here. Looked for ui/ in ${process.cwd()} and in ${resolve('src')}. Point --root at the directory ui/ sits under.`,
            )
            return 1
        }
        return await body(app, given)
    }
}

/**
 * The app `--root` finds and where its build goes — `undefined` where there is no app.
 *
 * BESIDE THE APP RATHER THAN BESIDE THE SHELL. An app's build belongs to the app, so
 * `abide build --root packages/app/src` run from anywhere puts it in `packages/app/.abide` — and
 * `abide start --root packages/app/src` then finds it without being told twice.
 */
function directoriesOf(values: Given['values']): AppDirectories | undefined {
    const root = appRoot(values.root)
    if (root === undefined) return undefined
    const out =
        values.out === undefined ? buildDirectory(root) : resolve(values.out)
    return { root, out }
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
    console.log(banner('abide', 'dev', packageUnder(root), server))
    return undefined
}

const code = await runCommands(DISK, Bun.argv.slice(2))
if (code !== undefined) process.exit(code)
