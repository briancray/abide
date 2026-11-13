#!/usr/bin/env bun
// The `abide` CLI: `commands.ts`'s list over the app on disk, and the commands that need the source
// and the compiler, which a compiled app's executable does not hold.

import { mkdir, rename, rm } from 'node:fs/promises' // bun exposes no directory creation, rename or recursive directory removal of its own
import { dirname, relative, resolve } from 'node:path' // bun exposes no path helpers of its own
import { brotliCompress, constants } from 'node:zlib' // bun's brotli is `CompressionStream`, which compresses on the main thread — 1390 ms against this pool's 300 ms over the docs bundle

import { paints } from '#compiler/appLayout.ts'
import { appMap, mapText } from '#compiler/appMap.ts'
import { BuildRefusal } from '#compiler/BuildRefusal.ts'
import { checkApp } from '#compiler/checkApp.ts'
import {
    compilationOf,
    compileApp,
    type CompiledApp,
} from '#compiler/compileApp.ts'
import { compiledEntry } from '#compiler/compiledEntry.ts'
import { type Diagnosis, printDiagnoses } from '#compiler/Diagnostics.ts'
import { formatAbide } from '#compiler/formatAbide.ts'
import { parseAbide } from '#compiler/parseAbide.ts'
import { scaffold } from '#compiler/scaffold.ts'
import { serveLanguage } from '#compiler/serveLanguage.ts'
import {
    abideModules,
    type Compilation,
    serverMapsOf,
} from '#server/abideModules.ts'
import {
    buildDirectory,
    type BuildFiles,
    buildFiles,
    builtFiles,
    markBuild,
    unmarkedBuild,
    writeWhole,
} from '#server/appBuild.ts'
import { banner } from '#server/banner.ts'
import { ENCODING_SUFFIX } from '#server/CLIENT_BUILD.ts'
import { type ClientBundle, clientBundle } from '#server/clientBundle.ts'
import { type Given, type Host, runCommands } from '#server/commands.ts'
import { type AppPackage, packageUnder } from '#server/config.ts'
import { appOnDisk, appRoot, noAppHere } from '#server/createApp.ts'
import { executableName } from '#server/executableName.ts'
import { iconAccent } from '#server/iconAccent.ts'
import { namesUnder } from '#server/namesUnder.ts'
import { skipped } from '#server/placement.ts'
import { realOrAsGiven } from '#server/realOrAsGiven.ts'
import { DEFAULT_DOCUMENT, intoHead } from '#server/render.ts'
import { runtimeRefusal } from '#server/runtimeRefusal.ts'
import { serveDev } from '#server/serveDev.ts'
import { publicKeyOf, publishUpdate, updateKey } from '#server/updateFeed.ts'
import { escapeText } from '#shared/escapeText.ts'
import { ICON_ADDRESSES, LAUNCHER_PAGE } from '#shared/LAUNCHER_FILES.ts'

import abidePackage from '../package.json' with { type: 'json' }

// 38.123 — the bun this process runs on, held to abide's `engines.bun` before anything is built or
// booted. A compiled app carries the bun `abide compile` ran on, which this held already.
const RUNTIME_REFUSAL = runtimeRefusal(Bun.version, abidePackage.engines.bun)

/** How many files `abide format` formats at once, each spawning `bun fmt` for its pieces. */
const FILES_AT_ONCE = 8

/** Where the app a command builds or serves is, and where its build goes — both absolute. */
type AppDirectories = { root: string; out: string }

/**
 * `abide`'s host: the app on disk, found by `--root` (38.25), and every command that needs the
 * source and the compiler.
 */
const DISK: Host = {
    name: 'abide',
    version: abidePackage.version,
    // 38.100 — built in this process rather than a child, where nobody built it, and said on
    // stderr: the command's stdout is its own — `openapi`'s document, `mcp`'s messages.
    app: ({ values }) => {
        const handle = appOnDisk(directoriesOf(values), (root, out) =>
            writeBuild({ root, out }, console.error),
        )
        return RUNTIME_REFUSAL === undefined
            ? handle
            : { ...handle, boot: async () => RUNTIME_REFUSAL }
    },
    source: {
        scaffold: scaffoldCommand,
        dev: inApp(dev),
        build: inApp(build),
        check: inApp(check),
        format: (given) =>
            given.positionals.length > 1
                ? format(namedPaths(given.positionals), given)
                : inApp(({ root }) => format([root], given))(given),
        routes: inApp(routes),
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

/**
 * `build`'s work; answers the app it built, or `undefined` where there was nothing under `root`.
 * `say` is where its summary goes.
 */
async function writeBuild(
    { root, out }: AppDirectories,
    say: (line: string) => void = console.log,
): Promise<CompiledApp | undefined> {
    process.env.NODE_ENV ??= 'production'
    // 38.66 — what this build may remove is only what was written before it began.
    const began = Date.now()
    // 38.100 — before anything can fail, so a build that fails leaves no build.
    const files = await unmarkedBuild(out)
    // `--out` is a real flag rather than a constant because two test files each building into
    // one `.abide/` is the contention CLAUDE.md's "checks" section already records once.
    const app = await compileApp(root)
    printDiagnoses(app.warnings, console.warn)
    if (
        Object.keys(app.files).length === 0 &&
        Object.keys(app.handlers).length === 0
    ) {
        say(`abide build: no .abide sources or handlers under ${root}`)
        return undefined
    }
    // 38.6 — THE COMPILATION, KEPT WHOLE: `abide start` serves every `.abide` out of it at the
    // file's own path, with no compiler, and a module's imports resolve from the source they name.
    const compilation = compilationOf(app)
    // 36.11 — the directories above `public` and the path below it ARE the address.
    // `src/public/favicon.ico` answers at `/favicon.ico`, and nothing declares that anywhere.
    await writeClient(
        files,
        await clientBundle(root, compilation, app.published, 'build'),
        began,
    )
    // An app's static files are its own whether or not it has a page yet.
    const copied = await copyPublic(root, files, app.published, began)
    await markBuild(files, compilation)
    say(
        `abide build: ${app.sources} source(s), ${copied} public file(s) -> ${out}`,
    )
    return app
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
 * 38.10 — THE BUILD, AND THEN ONE EXECUTABLE PER TARGET with all of it inside (`compiledEntry`).
 * `--out` is the executable rather than the build, which goes where `abide build` puts it; with no
 * `--out` the executable is the app's own name, in the directory the command was run from (38.46).
 */
async function compile(
    { root }: AppDirectories,
    { values }: Given,
): Promise<number> {
    // 38.48.
    if (values.target !== undefined && values.platforms !== undefined) {
        console.error(
            'abide compile: --target is one platform and --platforms is several; give one of them.',
        )
        return 1
    }
    const written = await writtenEntry(root, undefined)
    if (written === undefined) {
        console.error(`abide compile: nothing under ${root} to compile.`)
        return 1
    }
    const named = resolve(values.out ?? executableName(packageUnder(root).name))
    const platforms =
        values.platforms?.split(',') ??
        (values.target === undefined ? [undefined] : [values.target])
    for (const platform of platforms) {
        // 38.47.
        const outfile =
            values.platforms === undefined ? named : `${named}-${platform}`
        await compileExecutable(root, written, platform, outfile)
        console.log(`abide compile: ${outfile}`)
    }
    return 0
}

/**
 * `abide bundle`: builds the app, then a desktop app for this platform around its executable.
 *
 * 38.10, 38.70 — `compile`'s executable, started from `runDesktop`, inside a `.app` named after the
 * app where the command was run, or at `--out`.
 */
async function bundle(
    { root }: AppDirectories,
    { values }: Given,
): Promise<number> {
    // 38.77.
    if (process.platform !== 'darwin') {
        console.error(
            `abide bundle: a desktop app is built for macOS, and this is ${process.platform}. \`abide compile\` builds an executable for any platform.`,
        )
        return 1
    }
    const identity = packageUnder(root)
    const name = executableName(identity.name)
    const out = resolve(values.out ?? `${name}.app`)
    if (!out.endsWith('.app')) {
        console.error(
            `abide bundle: --out names the .app to write, and ${out} is not one.`,
        )
        return 1
    }
    // 38.146 — read before the build, so a mistyped path costs nothing.
    let notes: string | null = null
    if (values.notes !== undefined) {
        const file = Bun.file(resolve(values.notes))
        if (!(await file.exists())) {
            console.error(
                `abide bundle: --notes names ${resolve(values.notes)}, and there is no such file.`,
            )
            return 1
        }
        notes = (await file.text()).trim()
    }
    // 38.147 — the key is the build's: its public half is built into the executable.
    const key = await updateKey(name)
    const publicKey = await publicKeyOf(key.privateKey)
    const entry = await writtenEntry(root, async (app) => {
        const launcherPath = `${root}/${LAUNCHER_PAGE}`
        const hasLauncher = app.files[LAUNCHER_PAGE] !== undefined
        const art = await launcherIcon(root)
        return {
            // 38.82 — the page, where it paints: a `launcher.abide` of its script blocks alone keeps
            // the built-in page, and what its `onLauncher` answers is filed by the boot (37.1).
            launch:
                hasLauncher &&
                paints(parseAbide(await Bun.file(launcherPath).text()))
                    ? launcherPath
                    : undefined,
            document: launchDocument(app),
            icon: art?.icon,
            accent: art?.accent,
            publicKey,
        }
    })
    if (entry === undefined) {
        console.error(`abide bundle: nothing under ${root} to bundle.`)
        return 1
    }
    await compileExecutable(
        root,
        entry,
        undefined,
        `${out}/Contents/MacOS/${name}`,
    )
    const icon = await writeIcon(root, `${out}/Contents/Resources`)
    await Bun.write(
        `${out}/Contents/Info.plist`,
        infoPlist(name, identity, icon),
    )
    // AD-HOC SIGNED, WHOLE: the executable bun wrote is signed on its own, and a bundle around a
    // signed executable that is not itself signed is one Gatekeeper reads as damaged.
    if ((await spawnedTool('codesign', ['--force', '--sign', '-', out])) !== 0)
        return 1
    // 38.146 — zipped AFTER signing, so the update is the build this command just wrote.
    const updates = `${dirname(out)}/updates`
    const feed = await publishUpdate(
        out,
        updates,
        {
            version: identity.version ?? '0.0.0',
            required: values.required === true,
            notes,
        },
        key.privateKey,
    )
    console.log(`abide bundle: ${out}`)
    console.log(
        `abide bundle: ${updates} — ${feed.file} and latest.json, for the address onLauncher's update names`,
    )
    if (identity.version === undefined)
        console.warn(
            `abide bundle: package.json names no version, so the update reads 0.0.0, and no copy of the app installs it over its own. Set one, and raise it for each update.`,
        )
    if (key.made !== undefined)
        console.log(
            `abide bundle: made the key this app's updates are signed with, at ${key.made}. Keep a copy: every copy of the app installed trusts it and no other. To bundle the app anywhere else, set ABIDE_UPDATE_KEY to what it holds.`,
        )
    return 0
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
              app: CompiledApp,
          ) => Promise<Parameters<typeof compiledEntry>[0]['desktop']>)
        | undefined,
): Promise<{ entry: string; compilation: Compilation } | undefined> {
    const out = buildDirectory(root)
    const app = await writeBuild({ root, out })
    if (app === undefined) return undefined
    const entry = `${out}/compiled.ts`
    await Bun.write(
        entry,
        compiledEntry({
            desktop: await desktop?.(app),
            root,
            sourceMaps: serverMapsOf(app, root),
            package: packageUnder(root),
            ...(await builtFiles(out)),
        }),
    )
    return { entry, compilation: app }
}

/** One executable from `written`'s entry, for `platform` or this one, written to `outfile`. */
async function compileExecutable(
    root: string,
    written: { entry: string; compilation: Compilation },
    platform: string | undefined,
    outfile: string,
): Promise<void> {
    const compiled = await Bun.build({
        entrypoints: [written.entry],
        target: 'bun',
        // 34.16 — every `.abide` the app imports, as `abide start` serves it.
        plugins: [SERVER_STYLESHEETS, abideModules(root, written.compilation)],
        // UNMINIFIED, AND MAPPED: the executable is a server, and an error it logs is read by
        // whoever operates it — a minified line prints as the whole page module it sits in. The
        // map is embedded in the executable, which reads it from there.
        sourcemap: 'inline',
        // 38.93 — parsed at build time rather than on every boot. ESM because the entry awaits at
        // its top level, and bun's bytecode default is CommonJS, which refuses that. Nothing in the
        // executable or the build's outputs says bytecode is inside, so no test can see this.
        bytecode: true,
        format: 'esm',
        compile: {
            ...(platform === undefined
                ? {}
                : { target: `bun-${platform}` as Bun.Build.CompileTarget }),
            outfile,
            // 38.45 — THE EXECUTABLE IS THE BUILD'S, not the machine's: a `bunfig.toml`
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
 * The document `src/launcher.abide` renders into: abide's own, which the page writes its
 * `<html>` onto (35.15).
 *
 * 38.84 — THE PAGE'S OWN `<style>` IS IN ITS HEAD. A component's stylesheet reaches a browser with
 * its client module, and a launch page has none: it is rendered before the app it would load from
 * is served.
 */
function launchDocument(app: CompiledApp): string {
    const sheet = app.files[LAUNCHER_PAGE]?.sheet
    return sheet === undefined
        ? DEFAULT_DOCUMENT
        : intoHead(DEFAULT_DOCUMENT, `<style>\n${sheet}</style>`)
}

/**
 * The icon the launcher page shows, as a data URL, and the accent it takes from it — or nothing
 * where the app has no icon.
 *
 * 38.101 — drawn small by `sips` first: the accent is a fact about the picture, not its pixels.
 */
async function launcherIcon(
    root: string,
): Promise<{ icon: string; accent: string | undefined } | undefined> {
    const source = await publishedIcon(root)
    if (source === undefined) return undefined
    const drawn = async (size: number): Promise<Uint8Array | undefined> => {
        const path = `${buildDirectory(root)}/icon-${size}.png`
        const code = await spawnedTool('sips', [
            '-s',
            'format',
            'png',
            '-z',
            String(size),
            String(size),
            source,
            '--out',
            path,
        ])
        return code === 0 ? await Bun.file(path).bytes() : undefined
    }
    const [shown, sampled] = await Promise.all([drawn(256), drawn(64)])
    if (shown === undefined) return undefined
    return {
        icon: `data:image/png;base64,${shown.toBase64()}`,
        accent: sampled === undefined ? undefined : iconAccent(sampled),
    }
}

/**
 * Writes the bundle's icon from the public files the build copied, and answers whether there was one.
 *
 * 38.79 — the file at `/icon.icns` as it is, or the one at `/icon.png` drawn at every size an
 * `.icns` holds.
 */
async function writeIcon(root: string, resources: string): Promise<boolean> {
    const source = await publishedIcon(root)
    if (source === undefined) return false
    if (source.endsWith(ICON_ADDRESSES.icns)) {
        await Bun.write(`${resources}/icon.icns`, Bun.file(source))
        return true
    }
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
                    source,
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

/** 38.79 — the public file the app's icon is drawn from: `/icon.icns`, else `/icon.png`. */
async function publishedIcon(root: string): Promise<string | undefined> {
    const { published } = buildFiles(buildDirectory(root))
    for (const address of [ICON_ADDRESSES.icns, ICON_ADDRESSES.png])
        if (await Bun.file(`${published}${address}`).exists())
            return `${published}${address}`
    return undefined
}

/** Runs one of macOS's own tools, warning with what it wrote where it fails; answers its exit code. */
async function spawnedTool(tool: string, args: string[]): Promise<number> {
    const child = Bun.spawn([tool, ...args], {
        stdout: 'ignore',
        stderr: 'pipe',
    })
    // Drained beside the exit, so a tool that fills the pipe is not left waiting on a reader.
    const [code, said] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ])
    if (code !== 0)
        console.warn(`abide bundle: ${tool} failed — ${said.trim()}`)
    return code
}

/** The `Info.plist` a bundle names its executable, its identity and its icon in. */
function infoPlist(name: string, identity: AppPackage, icon: boolean): string {
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
        ['CFBundleName', `<string>${escapeText(name)}</string>`],
        ['CFBundleDisplayName', `<string>${escapeText(name)}</string>`],
        ['CFBundlePackageType', '<string>APPL</string>'],
        [
            'CFBundleShortVersionString',
            `<string>${identity.version ?? '0.0.0'}</string>`,
        ],
        ['CFBundleVersion', `<string>${identity.version ?? '0.0.0'}</string>`],
        ['LSMinimumSystemVersion', '<string>13.0</string>'],
        ['NSHighResolutionCapable', '<true/>'],
        ['NSPrincipalClass', '<string>NSApplication</string>'],
        // 38.71 — the app served on loopback over http, and one connected to wherever it runs.
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
 * Copies the app's public files into the build output, each at its address, and returns how many.
 *
 * 38.18 — every `public` directory, copied into the built output at the address each file is
 * answered at, so `abide start` reads the address off the output's own layout. Copied rather than
 * left where it is, so `abide start` answers out of what the build produced and an app moving a
 * file after a build cannot change what is served.
 */
async function copyPublic(
    root: string,
    files: BuildFiles,
    published: Map<string, string>,
    began: number,
): Promise<number> {
    const copies: Promise<void>[] = []
    const produced = new Set<string>()
    // 36.12 — the bytes as authored. `Bun.write` of a `BunFile` is a copy and not a re-encode.
    for (const [source, address] of published) {
        produced.add(address.slice(1))
        copies.push(
            writeWhole(
                `${files.published}${address}`,
                Bun.file(`${root}/${source}`),
            ),
        )
    }
    await Promise.all(copies)
    // 38.66 — a public file the app no longer has is no longer answered.
    await pruneStale(files.published, produced, began)
    return published.size
}

/**
 * Writes the client bundle (`clientBundle`) into the build, with its manifest and precompressed copies.
 *
 * 38.5 — the manifest beside the bundle, and every file in each encoding (`precompressed`). AN APP
 * OF HANDLERS ALONE is written no client, and its manifest anyway, so `abide start` reads one shape
 * whatever the app holds.
 */
async function writeClient(
    files: BuildFiles,
    bundle: ClientBundle,
    began: number,
): Promise<void> {
    const { client } = files
    // 38.66 — STAGED, THEN MOVED IN FILE BY FILE. A second build into the same `out` — or `abide
    // start` serving it — read a chunk half written, and emptying `client/` first took the one it
    // was serving away. Every name but the manifest's is a hash of what it holds, so two builds of
    // one tree move in the same bytes under the same names.
    const staging = `${dirname(client)}/.staging-${crypto.randomUUID()}`
    try {
        const written: Promise<void>[] = []
        for (const [name, { bytes }] of bundle.files)
            written.push(precompressed(`${staging}/${name}`, bytes))
        await Promise.all(written)
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
        await pruneStale(client, produced, began)
        await writeWhole(files.manifest, JSON.stringify(bundle.manifest))
    } finally {
        await rm(staging, { recursive: true, force: true })
    }
}

/**
 * Writes `bytes` to `path`, and brotli and gzip copies of them beside it.
 *
 * 38.5 — EVERY FILE THE BUNDLE WROTE, BESIDE ITSELF IN EACH OF `ENCODING_SUFFIX`'s ENCODINGS, at
 * the highest level each has. The price is paid here once, where a server compressing per request
 * would pay it on every response or settle for a worse level to keep the response fast.
 *
 * ALL AT ONCE. The async brotli runs off the main thread, so the files compress side by side
 * rather than one after another — brotli at 11 is most of what this step costs.
 */
async function precompressed(
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
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
        Bun.write(path, bytes),
        Bun.write(path + ENCODING_SUFFIX.br, brotli),
        Bun.write(
            path + ENCODING_SUFFIX.gzip,
            Bun.gzipSync(bytes, { level: 9 }),
        ),
    ])
}

/**
 * Removes from `directory` what this build did not produce.
 *
 * A CHUNK WHOSE HASH CHANGED leaves the old one behind otherwise, and the directory is the union of
 * every build ever run into it — and the cost is not disk: a grep over the built output answers about
 * code no page loads. 38.66 — only what was written before this build began: anything newer is a
 * concurrent build's, and its manifest may name it.
 */
async function pruneStale(
    directory: string,
    produced: ReadonlySet<string>,
    began: number,
): Promise<void> {
    const stale: Promise<void>[] = []
    // A file gone since the scan reads as last written in the far future, and is left alone.
    for (const name of namesUnder(directory))
        if (
            !produced.has(name) &&
            Bun.file(`${directory}/${name}`).lastModified < began
        )
            stale.push(rm(`${directory}/${name}`, { force: true }))
    await Promise.all(stale)
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
        if (RUNTIME_REFUSAL !== undefined) {
            console.error(`abide ${given.positionals[0]}: ${RUNTIME_REFUSAL}`)
            return 1
        }
        const app = directoriesOf(given.values)
        if (app === undefined) {
            console.error(
                `abide ${given.positionals[0]}: ${noAppHere()} Point --root at the directory your pages sit under.`,
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
    const { written, skipped: kept } = await scaffold(name, into)
    for (const path of written) console.log(`  wrote   ${path}`)
    for (const path of kept) console.log(`  kept    ${path}`)
    console.log(
        // The starter's own script: `abide` alone is on no PATH until it is installed globally.
        `\nabide scaffold: ${into}\n\n  cd ${name}\n  bun install\n  bun run dev`,
    )
    return 0
}

/** `abide routes`: the app's map, as text or with `--json` as one document. 38.108. */
async function routes(
    { root }: AppDirectories,
    { values }: Given,
): Promise<number> {
    const map = await appMap(root)
    console.log(values.json ? JSON.stringify(map, null, 4) : mapText(map))
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
    const within = namedPaths(positionals)
    const found: Diagnosis[] = []
    for (const diagnosis of await checkApp(root))
        if (
            within.length === 0 ||
            within.some(
                (directory) =>
                    diagnosis.path === directory ||
                    diagnosis.path.startsWith(`${directory}/`),
            )
        )
            found.push(diagnosis)
    const { errors, warnings } = printDiagnoses(found, console.log)
    console.log(
        `abide check: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`,
    )
    return errors > 0 ? 1 : 0
}

/** The paths a command's `[path…]` names, each as the real path a finding is filed under. */
function namedPaths(positionals: string[]): string[] {
    const named: string[] = []
    for (const directory of positionals.slice(1))
        named.push(realOrAsGiven(resolve(directory)))
    return named
}

/**
 * `abide format`: formats every `.abide` `within` names — a file named, every one under a directory
 * named, or the app where none are — and fails where any file was left as written. 38.125, 38.128.
 *
 * `--check` writes nothing, and fails where a file would change. 38.129.
 *
 * NAMED DIRECTORIES NEED NO APP, unlike `check`'s: a formatter reads one file at a time, so a
 * monorepo formats every app under it in one run.
 */
async function format(within: string[], { values }: Given): Promise<number> {
    const paths: string[] = []
    for (const named of within) {
        // a path that names nothing is a directory holding no `.abide`, as `namesUnder` reads it
        const stat = await Bun.file(named)
            .stat()
            .catch(() => undefined)
        if (stat?.isFile() === true) {
            paths.push(named)
            continue
        }
        for (const name of namesUnder(named, '**/*.abide'))
            if (!name.split('/').some(skipped)) paths.push(`${named}/${name}`)
    }
    let changed = 0
    let errors = 0
    // A file's pieces are formatted in parallel already, so files are taken a few at a time.
    let next = 0
    const take = async (): Promise<void> => {
        while (next < paths.length) {
            const path = paths[next] as string
            next += 1
            const text = await Bun.file(path).text()
            const formatted = await formatAbide(path, text)
            errors += printDiagnoses(formatted.findings, console.log).errors
            if (formatted.text === text) continue
            changed += 1
            if (values.check)
                console.log(
                    `${relative(process.cwd(), path)} - needs formatting`,
                )
            else await Bun.write(path, formatted.text)
        }
    }
    await Promise.all(Array.from({ length: FILES_AT_ONCE }, take))
    const files = `${changed} file${changed === 1 ? '' : 's'}`
    console.log(
        `abide format: ${values.check ? `${files} to format` : `${files} formatted`} of ${paths.length}, ${errors} error${errors === 1 ? '' : 's'}`,
    )
    return errors > 0 || (values.check && changed > 0) ? 1 : 0
}

/**
 * `abide lsp`: the language server over stdio.
 *
 * 38.11 — the language server, for as long as the editor holds stdin open. Nothing is printed: stdout
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
    { values: { port, hostname } }: Given,
): Promise<undefined> {
    process.env.NODE_ENV ??= 'development'
    const server = await serveDev({
        root,
        port: port === undefined ? undefined : Number(port),
        hostname,
    })
    console.log(banner('abide', 'dev', packageUnder(root), server, hostname))
    return undefined
}

// 38.139 — a build that stops on a refusal says what it refused, as `abide check` does, and fails.
const code = await runCommands(DISK, Bun.argv.slice(2)).catch(
    (thrown: unknown) => {
        if (!(thrown instanceof BuildRefusal)) throw thrown
        console.error(thrown.message)
        return 1
    },
)
if (code !== undefined) process.exit(code)
