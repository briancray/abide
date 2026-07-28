// main(argv) — the `abide` CLI subcommand dispatcher (M-CLI / CL1 / BP1-3).
//
// Commands: `dev` (watched serve + live-reload), `build` (content-addressed client bundle into
// dist/_app/<hash>/), `start` (serve the loaded app, no watch), `scaffold <name>` (write a minimal
// starter project, then `git init` + `bun install` + `abide dev`, each skippable via
// `--no-git`/`--no-install`/`--no-dev`). Anything else prints usage.
//
// `dev`/`start` return the running `ServeResult` (the process stays alive on Bun.serve's handles);
// `build`/`scaffold` return undefined after their one-shot work.

import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BundleWindow } from '../bundle/BundleWindow.ts'
import {
    buildClient,
    type ClientBuild,
    ENCODING_EXTENSION,
    loadClientBuild,
} from '../server/internal/clientBundle.ts'
import { loadApp, writeBakedSchemas } from '../server/internal/loadApp.ts'
import { bundleLauncher } from './bundleLauncher.ts'
import { check } from './check.ts'
import { compile } from './compile.ts'
import { installShutdownHandlers } from './installShutdownHandlers.ts'
import { lspServer } from './lsp.ts'
import { parsePort } from './parsePort.ts'
import { type ServeResult, serve } from './serve.ts'

const USAGE = `abide — isomorphic type-safe framework

Usage:
  abide dev [--port <n>]      start the dev server (watch + live-reload)
  abide build                 build the content-addressed client bundle into dist/_app/<hash>/
  abide start [--port <n>]    serve the app (no watch)
  abide scaffold <name>       create a starter project, then git init + install + dev
  abide check                 type-check .abide script bodies (best-effort, via TS7)
  abide lsp                   run the .abide language server over stdio (diagnostics)
  abide compile               build the standalone executable (app + assets embedded)
  abide bundle                build the desktop launcher into dist/bundle/ (host platform)

The executable IS the app: run it bare for the interactive REPL, with an rpc name to call that
rpc, or "serve" to host it.

Options:
  --port <n>                  listen port (default: PORT env or 3000; dev hops to the next open port)
  --target <triple>           compile: bun target (e.g. bun-linux-x64; default: host)
  --out <path>                compile: output executable path (default: dist/<app name>);
                              with --platforms it is the output DIRECTORY
  --platforms [a,b]           compile: cross-compile one binary per target (bare = the default set)
  --no-git                    scaffold: skip git init
  --no-install                scaffold: skip bun install
  --no-dev                    scaffold: skip starting the dev server
  -h, --help                  show this help`

// The first positional (non-flag) argument, skipping the value consumed by `--port`. Used by
// `scaffold` to read the project <name> even when it follows `--port <n>`.
function firstPositional(argv: string[]): string | undefined {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === undefined) continue
        if (arg === '--port') {
            i++ // skip the port value
            continue
        }
        if (!arg.startsWith('-')) return arg
    }
    return undefined
}

// The value of a `--flag <value>` option, or undefined when the flag is absent or trails nothing. A
// following flag is not a value (`--target --out x` yields undefined for `--target`).
function flagValue(argv: string[], flag: string): string | undefined {
    const index = argv.indexOf(flag)
    if (index === -1) return undefined
    const raw = argv[index + 1]
    if (raw === undefined || raw.startsWith('-')) return undefined
    return raw
}

// True unless the given boolean flag is present in argv (e.g. `--no-install`).
function flagAbsent(argv: string[], flag: string): boolean {
    return !argv.includes(flag)
}

// Run a command to completion in `cwd`, inheriting stdio so its output is visible. Returns whether
// it exited 0; a missing binary or spawn failure is caught and reported rather than thrown.
async function runStep(command: string[], cwd: string): Promise<boolean> {
    try {
        const proc = Bun.spawn(command, { cwd, stdio: ['inherit', 'inherit', 'inherit'] })
        const code = await proc.exited
        if (code !== 0) console.error(`abide scaffold: \`${command.join(' ')}\` exited ${code}`)
        return code === 0
    } catch (caught) {
        console.error(
            `abide scaffold: \`${command.join(' ')}\` failed:`,
            caught instanceof Error ? caught.message : String(caught),
        )
        return false
    }
}

// Build the code-split client and write every content-hashed file (loader entry + per-route chunks +
// shared chunks + CSS), plus a manifest, into dist/_app/<hash>/ (BP1.3, TODO #6). Returns the absolute
// output dir. The outer hash is a deterministic digest of the manifest (entry + sorted filenames), so
// the same source yields the same dir (immutable long-cache, reproducible builds).
export async function build(dir: string): Promise<string> {
    // Drop any prior baked schema map so this build derives FRESH from the current source (§11.5),
    // rather than loadApp reusing a stale `dist/schemas.json`.
    await rm(join(dir, 'dist', 'schemas.json'), { force: true })
    const config = await loadApp(dir)
    config.dev = false // production build → minify the client bundle (TODO #6).
    const built = await buildClient(config)
    const names = [...built.files.keys()].sort()
    // Which encodings each asset ships as a sidecar. Part of the manifest — and therefore part of the
    // hash below — because the set of representations served at a URL is part of what that URL IS: a
    // build that gains brotli must land in a fresh immutable directory, not overwrite an old one that
    // clients and shared caches still hold identity bytes for.
    const encodings: Record<string, string[]> = {}
    for (const name of names) {
        const asset = built.files.get(name)
        if (asset === undefined) continue
        const available: string[] = []
        if (asset.brotli !== null) available.push('brotli')
        if (asset.gzip !== null) available.push('gzip')
        if (available.length > 0) encodings[name] = available
    }
    const manifest = {
        entry: built.entry,
        css: built.cssFile ?? null,
        files: names,
        encodings,
        chunkByPattern: Object.fromEntries(built.chunkByPattern),
    }
    const hash = new Bun.CryptoHasher('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex')
        .slice(0, 16)
    const outDir = join(dir, 'dist', '_app', hash)
    await mkdir(outDir, { recursive: true })
    for (const name of names) {
        const asset = built.files.get(name)
        if (asset === undefined) continue
        await Bun.write(join(outDir, name), asset.identity)
        if (asset.brotli !== null)
            await Bun.write(join(outDir, name + ENCODING_EXTENSION.brotli), asset.brotli)
        if (asset.gzip !== null)
            await Bun.write(join(outDir, name + ENCODING_EXTENSION.gzip), asset.gzip)
    }
    const record = JSON.stringify({ hash, ...manifest }, null, 2)
    await Bun.write(join(outDir, 'index.json'), record)
    // Stable top-level pointer so `abide start` finds the current build without scanning hash dirs.
    await Bun.write(join(dir, 'dist', 'manifest.json'), record)
    // Bake the type-derived schemas (§11.5) alongside the manifest, so `abide start` (and a future
    // source-less `compile`/`cli`) merges them at boot without a tsgo pass. `config.routes` already
    // carry the freshly-derived schemas from the `loadApp` above.
    if (config.routes !== undefined) await writeBakedSchemas(dir, config.routes)
    return outDir
}

// Ensure a production client build exists on disk (build it if missing) and load it for serving, so
// `abide start` serves the EXACT `abide build` artifacts with no bundler at boot.
async function ensureClientBuild(dir: string): Promise<ClientBuild> {
    let built = await loadClientBuild(dir)
    if (built === undefined) {
        await build(dir)
        built = await loadClientBuild(dir)
    }
    if (built === undefined) throw new Error('abide start: failed to produce a client build')
    return built
}

// Read the optional declarative window config (BU3) from `src/bundle/window.ts` if present. Returns
// the default export (a BundleWindow) or an empty config when the file is absent. Dynamic-imported so
// a project without a bundle window still bundles.
async function loadBundleWindow(dir: string): Promise<BundleWindow> {
    const path = join(dir, 'src', 'bundle', 'window.ts')
    if (!(await Bun.file(path).exists())) return {}
    const module = (await import(path)) as { default?: BundleWindow }
    return module.default ?? {}
}

// Build the desktop bundle launcher (BU1-4, MVP). Builds the client bundle (fails loud on a broken
// app), reads the declarative BundleWindow, and writes a self-contained launcher script under
// dist/bundle/. The launcher — not this build step — is what opens the window, so `abide bundle`
// never spawns UI. Host-platform only (BU1.3). Returns the absolute output dir.
export async function bundle(dir: string): Promise<string> {
    await build(dir)
    const window = await loadBundleWindow(dir)

    const outDir = join(dir, 'dist', 'bundle')
    await mkdir(outDir, { recursive: true })
    await Bun.write(join(outDir, 'window.json'), JSON.stringify(window, null, 2))
    await Bun.write(join(outDir, 'launch.ts'), bundleLauncher(window))
    return outDir
}

// The single default starter (CL1.2) lives as a real, dogfooded workspace package — `packages/starter`
// — so it type-checks, lints, and runs like any authored app instead of hiding in code as strings.
// `scaffold` copies its src/tsconfig verbatim, swapping only the app name and the `workspace:*` abide
// dep for a published range. Resolved relative to this file: `src/cli` → up three → `packages/`.
const STARTER_DIR = join(import.meta.dir, '../../../starter')

// Copy the starter package into a fresh `name/` project. Returns the project root.
export async function scaffold(dir: string, name: string): Promise<string> {
    const root = join(dir, name)

    // The whole src/ tree verbatim (skip any generated `.abide` output if the template was ever built).
    const srcDir = join(STARTER_DIR, 'src')
    const glob = new Bun.Glob('**/*')
    for await (const relative of glob.scan({ cwd: srcDir, onlyFiles: true, dot: true })) {
        if (relative.startsWith('.abide/')) continue
        await Bun.write(join(root, 'src', relative), Bun.file(join(srcDir, relative)))
    }

    // tsconfig verbatim; package.json rewritten with the app name + a published abide range.
    await Bun.write(join(root, 'tsconfig.json'), Bun.file(join(STARTER_DIR, 'tsconfig.json')))
    const pkg = await Bun.file(join(STARTER_DIR, 'package.json')).json()
    pkg.name = name
    if (pkg.dependencies?.abide) pkg.dependencies.abide = '^0.0.0'
    // The Playwright e2e harness (playwright.config, e2e/, scripts/serve-e2e) is monorepo-only
    // dogfooding of the template — serve-e2e imports abide by workspace path and can't ship in an app.
    // Its files live outside src/ (never copied); strip the matching scripts + dep from the output.
    delete pkg.scripts?.e2e
    delete pkg.scripts?.['e2e:ci']
    delete pkg.devDependencies?.['@playwright/test']
    await Bun.write(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)

    return root
}

// Whether Bun can host the tsgo `API` pipe in-process (today: no; the LSP forwards to node). Flip via
// `ABIDE_LSP_INPROCESS=1` once Bun gains support — the `lspServer` code path is identical either way.
function bunCanHostTsgo(): boolean {
    return process.env.ABIDE_LSP_INPROCESS === '1'
}

// `abide lsp` (Bun) → `node lsp.ts` (persistent server): a dumb bidirectional byte pump over stdio.
async function forwardLsp(cwd: string): Promise<void> {
    const lspPath = fileURLToPath(new URL('./lsp.ts', import.meta.url))
    const child = Bun.spawn(['node', lspPath], {
        cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit',
    })
    const pumpIn = (async () => {
        const reader = Bun.stdin.stream().getReader()
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            child.stdin.write(value)
            await child.stdin.flush()
        }
        child.stdin.end()
    })()
    const pumpOut = (async () => {
        for await (const chunk of child.stdout) process.stdout.write(chunk)
    })()
    await child.exited
    await Promise.allSettled([pumpIn, pumpOut])
}

export async function main(argv: string[]): Promise<ServeResult | undefined> {
    const command = argv[0]
    const rest = argv.slice(1)
    const cwd = process.cwd()

    if (command === 'dev') {
        const running = await serve(cwd, { dev: true, port: parsePort(rest) })
        installShutdownHandlers(running)
        console.info(`abide dev — ${running.url}`)
        return running
    }

    if (command === 'start') {
        // Serve the client artifacts produced by `abide build` (building them if absent) — no bundler
        // runs at request time.
        const clientBuild = await ensureClientBuild(cwd)
        const running = await serve(cwd, { dev: false, port: parsePort(rest), clientBuild })
        installShutdownHandlers(running)
        console.info(`abide start — ${running.url}`)
        return running
    }

    if (command === 'build') {
        const outDir = await build(cwd)
        console.info(`abide build — ${outDir}`)
        return undefined
    }

    if (command === 'check') {
        const result = await check(cwd)
        if (result.ok) {
            console.info('abide check — no type errors in .abide script bodies')
            return undefined
        }
        for (const diagnostic of result.diagnostics) {
            console.error(
                `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} — TS${diagnostic.code}: ${diagnostic.message}`,
            )
        }
        console.error(
            `\nabide check — ${result.diagnostics.length} error${result.diagnostics.length === 1 ? '' : 's'}`,
        )
        process.exitCode = 1
        return undefined
    }

    if (command === 'lsp') {
        // The tsgo `API` can't open its pipe under Bun, so by default forward stdio to `node lsp.ts` (a
        // persistent server). `bunCanHostTsgo()` flips to in-process the day Bun can host it — revert = drop
        // the forwarder branch. `ABIDE_LSP_INPROCESS=1` forces in-process (for that future / testing).
        if (bunCanHostTsgo()) {
            await lspServer({
                projectRoot: cwd,
                read: Bun.stdin.stream(),
                write: (bytes) => void process.stdout.write(bytes),
            })
        } else {
            await forwardLsp(cwd)
        }
        return undefined
    }

    // ONE build. The executable it produces serves (`serve`), dispatches rpcs as subcommands, and
    // runs interactive — chosen when it RUNS, so there is nothing to pick here.
    if (command === 'compile') {
        // `--platforms` with no value (or a trailing flag after it) means the default release set.
        const platforms = rest.includes('--platforms')
            ? (flagValue(rest, '--platforms')?.split(',').filter(Boolean) ?? [])
            : undefined
        const built = await compile(cwd, {
            target: flagValue(rest, '--target'),
            out: flagValue(rest, '--out'),
            platforms,
        })
        for (const outfile of built) console.info(`abide compile — ${outfile}`)
        return undefined
    }

    if (command === 'bundle') {
        const outDir = await bundle(cwd)
        console.info(`abide bundle — ${outDir}`)
        console.info(`  run: bun ${join(outDir, 'launch.ts')}`)
        console.info(
            `  note: native windowing is best-effort (system webview binary or default browser)`,
        )
        return undefined
    }

    if (command === 'scaffold') {
        const name = firstPositional(rest)
        if (name === undefined || name.length === 0) {
            console.error('abide scaffold: missing project <name>.\n')
            console.info(USAGE)
            return undefined
        }
        const root = await scaffold(cwd, name)
        console.info(`abide scaffold — created ${root}`)

        if (flagAbsent(rest, '--no-git')) await runStep(['git', 'init'], root)
        if (flagAbsent(rest, '--no-install')) {
            const installed = await runStep(['bun', 'install'], root)
            if (!installed) {
                // Booting the dev server against an app whose deps (including abide) never installed
                // fails deep in module resolution with a confusing stack — stop cleanly and signal failure.
                console.error(
                    'abide scaffold: `bun install` failed — skipping the dev server. Fix the install, then run `bun run dev`.',
                )
                process.exitCode = 1
                console.info(`  cd ${name} && bun install && bun run dev`)
                return undefined
            }
        }

        if (flagAbsent(rest, '--no-dev')) {
            const running = await serve(root, { dev: true, port: parsePort(rest) })
            installShutdownHandlers(running)
            console.info(`abide dev — ${running.url}`)
            return running
        }

        console.info(`  cd ${name} && bun run dev`)
        return undefined
    }

    console.info(USAGE)
    return undefined
}
