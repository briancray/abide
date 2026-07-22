// main(argv) — the `abide` CLI subcommand dispatcher (M-CLI / CL1 / BP1-3).
//
// Commands: `dev` (watched serve + live-reload), `build` (content-addressed client bundle into
// dist/_app/<hash>/), `start` (serve the loaded app, no watch), `scaffold <name>` (write a minimal
// starter project, then `git init` + `bun install` + `abide dev`, each skippable via
// `--no-git`/`--no-install`/`--no-dev`). Anything else prints usage.
//
// `dev`/`start` return the running `ServeResult` (the process stays alive on Bun.serve's handles);
// `build`/`scaffold` return undefined after their one-shot work.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BundleWindow } from '../bundle/BundleWindow.ts'
import { buildClient, type ClientBuild, loadClientBuild } from '../server/internal/clientBundle.ts'
import { loadApp } from '../server/internal/loadApp.ts'
import { bundleLauncher } from './bundleLauncher.ts'
import { check } from './check.ts'
import { lspServer } from './lsp.ts'
import { type ServeResult, serve } from './serve.ts'

const USAGE = `abide — isomorphic type-safe framework

Usage:
  abide dev [--port <n>]      start the dev server (watch + live-reload)
  abide build                 build the content-addressed client bundle into dist/_app/<hash>/
  abide start [--port <n>]    serve the app (no watch)
  abide scaffold <name>       create a starter project, then git init + install + dev
  abide check                 type-check .abide script bodies (best-effort, via TS7)
  abide lsp                   run the .abide language server over stdio (diagnostics)
  abide bundle                build the desktop launcher into dist/bundle/ (host platform)

Options:
  --port <n>                  listen port (default: PORT env or 3000; dev hops to the next open port)
  --no-git                    scaffold: skip git init
  --no-install                scaffold: skip bun install
  --no-dev                    scaffold: skip starting the dev server
  -h, --help                  show this help`

// Pull `--port <n>` out of an argv tail; returns the parsed port or undefined.
function parsePort(argv: string[]): number | undefined {
    const index = argv.indexOf('--port')
    if (index === -1) return undefined
    const raw = argv[index + 1]
    if (raw === undefined) return undefined
    const port = Number(raw)
    return Number.isFinite(port) ? port : undefined
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
    const config = await loadApp(dir)
    config.dev = false // production build → minify the client bundle (TODO #6).
    const built = await buildClient(config)
    const names = [...built.files.keys()].sort()
    const manifest = {
        entry: built.entry,
        css: built.cssFile ?? null,
        files: names,
        chunkByPattern: Object.fromEntries(built.chunkByPattern),
    }
    const hash = new Bun.CryptoHasher('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex')
        .slice(0, 16)
    const outDir = join(dir, 'dist', '_app', hash)
    await mkdir(outDir, { recursive: true })
    for (const name of names) {
        const content = built.files.get(name)
        if (content !== undefined) await Bun.write(join(outDir, name), content)
    }
    const record = JSON.stringify({ hash, ...manifest }, null, 2)
    await Bun.write(join(outDir, 'index.json'), record)
    // Stable top-level pointer so `abide start` finds the current build without scanning hash dirs.
    await Bun.write(join(dir, 'dist', 'manifest.json'), record)
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

// Grace window for onStop teardown during shutdown before the process is force-exited — a buggy hook
// that never resolves must not turn a crash or a Ctrl-C into a hang.
const SHUTDOWN_TEARDOWN_DEADLINE_MS = 5000

// Process-level shutdown handling for the long-lived dev/start server. Two triggers route through one
// path so the app's `onStop` teardown (drain + close) always runs before exit instead of stranding
// in-flight work:
//   - a crash (uncaughtException / unhandledRejection) → teardown, then exit 1;
//   - a signal (SIGINT / SIGTERM, e.g. Ctrl-C or a container stop) → graceful teardown, then exit 0.
// `running.stop()` drives onStop and its teardown backstop. Installed once per boot; a second trigger
// DURING teardown falls through the re-entrancy guard so the pending exit still fires, and a stalled
// teardown is force-exited by the deadline. Not wired into serve() itself — that's a library entry the
// test suite boots repeatedly, and per-boot exit handlers there would be wrong.
function installShutdownHandlers(running: ServeResult): void {
    let shuttingDown = false
    const shutdown = async (reason: string, exitCode: number, cause?: unknown): Promise<void> => {
        if (shuttingDown) return
        shuttingDown = true
        if (cause !== undefined) {
            console.error(`abide: ${reason} — running onStop teardown before exit:`, cause)
        } else {
            console.info(`abide: ${reason} — running onStop teardown before exit.`)
        }
        // Force-exit if teardown stalls (a hanging onStop) so shutdown never hangs. Unref'd so the timer
        // itself never keeps the process alive. A timed-out teardown is abnormal, so it always exits 1.
        const deadline = setTimeout(() => {
            console.error('abide: onStop teardown timed out during shutdown — forcing exit.')
            process.exit(1)
        }, SHUTDOWN_TEARDOWN_DEADLINE_MS)
        deadline.unref?.()
        try {
            await running.stop()
        } catch (stopError) {
            console.error('abide: onStop teardown itself failed during shutdown:', stopError)
            process.exit(1)
        }
        process.exit(exitCode)
    }
    process.on('uncaughtException', (error) => void shutdown('uncaught exception', 1, error))
    process.on('unhandledRejection', (reason) => void shutdown('unhandled rejection', 1, reason))
    process.on('SIGINT', () => void shutdown('SIGINT', 0))
    process.on('SIGTERM', () => void shutdown('SIGTERM', 0))
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
        const name = rest.find((arg) => !arg.startsWith('-'))
        if (name === undefined || name.length === 0) {
            console.error('abide scaffold: missing project <name>.\n')
            console.info(USAGE)
            return undefined
        }
        const root = await scaffold(cwd, name)
        console.info(`abide scaffold — created ${root}`)

        if (flagAbsent(rest, '--no-git')) await runStep(['git', 'init'], root)
        if (flagAbsent(rest, '--no-install')) await runStep(['bun', 'install'], root)

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
