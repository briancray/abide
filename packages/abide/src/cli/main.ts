// main(argv, options) — the `abide` CLI subcommand dispatcher (M-CLI / CL1 / BP1-3).
//
// Commands: `dev` (watched serve + live-reload), `build` (content-addressed client bundle into
// dist/_app/<hash>/), `start` (serve the loaded app, no watch), `scaffold <name>` (write a minimal
// starter project, then `git init` + `bun install` + `abide dev`, each skippable via
// `--no-git`/`--no-install`/`--no-dev`). A bare `abide` (or `-h`) prints usage; anything else is a
// usage ERROR — it goes to stderr and exits `CLI_EXIT_CODES.usage`, because a mistyped command that
// exits 0 tells a CI script the build succeeded.
//
// `options` exists so the dispatcher is callable from a test rather than only from a shell: `cwd`
// points it at a temp project and `write`/`writeError` capture what it printed. Defaults reproduce the
// shell behaviour exactly (`process.cwd()` + console), so `bin.ts` passes nothing.
//
// `dev`/`start` return the running `ServeResult` (the process stays alive on Bun.serve's handles);
// `build`/`scaffold` return undefined after their one-shot work.

import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BundleWindow } from '../bundle/BundleWindow.ts'
import { CLI_EXIT_CODES } from '../server/command/CLI_EXIT_CODES.ts'
import { banner, formatDuration, hint, serveBanner } from './banner.ts'
import { build, ensureClientBuild } from './build.ts'
import { bundleLauncher } from './bundleLauncher.ts'
import { check } from './check.ts'
import { compile } from './compile.ts'
import { firstPositional } from './firstPositional.ts'
import { flagAbsent } from './flagAbsent.ts'
import { flagValue } from './flagValue.ts'
import { installShutdownHandlers } from './installShutdownHandlers.ts'
import { lspServer } from './lsp.ts'
import { parsePort } from './parsePort.ts'
import { run } from './run.ts'
import { type ServeResult, serve } from './serve.ts'

// THE COMMAND TABLE. One entry per subcommand, carrying its own usage line, its summary and its
// implementation — so `abide --help` is GENERATED from the same rows the dispatcher reads.
//
// This used to be a flat `if (command === '…')` chain plus a `USAGE` template literal restating all
// nine names, their flags and their descriptions. Nothing tied the two: adding a branch and forgetting
// the string (or the reverse) compiled clean. That is exactly the failure `RESERVED_CLI_COMMANDS.ts`
// records for the COMPILED binary — where `completion` ended up listed in help, warned about as
// shadowing an author's rpc, and `unknown command` at the prompt — solved there and left standing
// here, forty lines away.
interface CommandContext {
    // Everything after the subcommand. `abide run` treats its own tail as the SCRIPT's.
    rest: string[]
    cwd: string
    write: (line: string) => void
    writeError: (line: string) => void
    usage: () => string
}

interface DevCommand {
    // The invocation, as help prints it (`abide dev [--port <n>]`).
    invocation: string
    summary: string
    run: (context: CommandContext) => Promise<ServeResult | undefined>
}

// Cross-cutting flags. These stay hand-written because they are not per-command in the way the rows
// above are — several commands read `--port`, and `compile` owns four of its own.
const USAGE_OPTIONS = `Options:
  --port <n>                  listen port (default: PORT env or 3000; dev hops to the next open port)
  --target <triple>           compile: bun target (e.g. bun-linux-x64; default: host)
  --out <path>                compile: output executable path (default: dist/<app name>);
                              with --platforms it is the output DIRECTORY
  --platforms [a,b]           compile: cross-compile one binary per target (bare = the default set)
  --no-git                    scaffold: skip git init
  --no-install                scaffold: skip bun install
  --no-dev                    scaffold: skip starting the dev server
  -h, --help                  show this help`

function usageText(): string {
    let lines = ''
    for (const command of Object.values(DEV_COMMANDS))
        lines += `  ${command.invocation.padEnd(26)}${command.summary}\n`
    return `abide — isomorphic type-safe framework

Usage:
${lines}
The executable IS the app: run it bare for the interactive REPL, with an rpc name to call that
rpc, or "serve" to host it.

${USAGE_OPTIONS}`
}

// Where the dispatcher reads its project from and writes its output to. Injectable so a test drives
// `main` in-process; the defaults are the shell's.
export interface MainOptions {
    cwd?: string | undefined
    write?: ((line: string) => void) | undefined
    writeError?: ((line: string) => void) | undefined
}

// Run a command to completion in `cwd`, inheriting stdio so its output is visible. Returns whether
// it exited 0; a missing binary or spawn failure is caught and reported rather than thrown.
async function runStep(
    command: string[],
    cwd: string,
    writeError: (line: string) => void,
): Promise<boolean> {
    try {
        const proc = Bun.spawn(command, { cwd, stdio: ['inherit', 'inherit', 'inherit'] })
        const code = await proc.exited
        if (code !== 0) writeError(`abide scaffold: \`${command.join(' ')}\` exited ${code}`)
        return code === 0
    } catch (caught) {
        writeError(
            `abide scaffold: \`${command.join(' ')}\` failed: ${
                caught instanceof Error ? caught.message : String(caught)
            }`,
        )
        return false
    }
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
// `scaffold` copies its `src/` + the root files below verbatim, swapping only the app name and the
// `workspace:*` abide dep for a published range. Resolved relative to this file: `src/cli` → up three
// → `packages/`.
const STARTER_DIR = join(import.meta.dir, '../../../starter')

// Root-level template files copied verbatim. NAMED rather than globbed, because the template dir also
// holds the monorepo-only e2e harness (`playwright.config.ts`, `e2e/`, `scripts/`) that cannot ship in
// a scaffolded app — see the package.json stripping below.
//
// `.gitignore` is load-bearing, not tidiness: `scaffold` runs `git init` (unless `--no-git`), so
// without one the first `git add .` in a fresh app commits `node_modules/`, `dist/`, and the GENERATED
// `src/.abide/health.d.ts` — which the whole health-companion design (CO2.4) assumes is regenerated,
// never tracked. That invariant held in this monorepo only via the ROOT `.gitignore`, which no
// scaffolded app ever sees.
// `README.md` rides along for the same reason: it is the only thing in a fresh app that says what the
// scripts are and where files go, and a scaffolded project has no monorepo around it to infer that from.
const STARTER_ROOT_FILES = ['tsconfig.json', '.gitignore', 'README.md'] as const

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

    // tsconfig + .gitignore verbatim; package.json rewritten with the app name + a published abide range.
    for (const file of STARTER_ROOT_FILES) {
        await Bun.write(join(root, file), Bun.file(join(STARTER_DIR, file)))
    }
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

export const DEV_COMMANDS: Record<string, DevCommand> = {
    dev: {
        invocation: 'abide dev [--port <n>]',
        summary: 'start the dev server (watch + live-reload)',
        run: async ({ cwd, rest, write }) => {
            const startedAt = performance.now()
            const running = await serve(cwd, { dev: true, port: parsePort(rest) })
            installShutdownHandlers(running)
            write(
                serveBanner({
                    url: running.url,
                    requestedPort: running.requestedPort,
                    elapsedMilliseconds: performance.now() - startedAt,
                    notes: ['watching src/'],
                }),
            )
            return running
        },
    },

    build: {
        invocation: 'abide build',
        summary: 'build the content-addressed client bundle into dist/_app/<hash>/',
        run: async ({ cwd, write }) => {
            const startedAt = performance.now()
            // `build` answers a `BuildResult`, not a path — the binding was named `outDir` and
            // interpolated whole, so this line printed `abide build — [object Object]`.
            const { outDir } = await build(cwd)
            write(
                banner(
                    [{ label: 'output', value: outDir }],
                    [`built in ${formatDuration(performance.now() - startedAt)}`],
                ),
            )
            return undefined
        },
    },

    start: {
        invocation: 'abide start [--port <n>]',
        summary: 'serve the app (no watch)',
        run: async ({ cwd, rest, write }) => {
            const startedAt = performance.now()
            // Serve the client artifacts produced by `abide build` (building them if absent) — no
            // bundler runs at request time.
            const clientBuild = await ensureClientBuild(cwd)
            const running = await serve(cwd, { dev: false, port: parsePort(rest), clientBuild })
            installShutdownHandlers(running)
            // No port note is possible here and none is wanted: `start` binds what it was asked for,
            // so a clash is an EADDRINUSE rather than a quiet move to explain.
            write(
                serveBanner({
                    url: running.url,
                    requestedPort: running.requestedPort,
                    elapsedMilliseconds: performance.now() - startedAt,
                }),
            )
            return running
        },
    },

    scaffold: {
        invocation: 'abide scaffold <name>',
        summary: 'create a starter project, then git init + install + dev',
        run: async ({ cwd, rest, write, writeError, usage }) => {
            const name = firstPositional(rest)
            if (name === undefined || name.length === 0) {
                // A missing <name> is a wrong command line, not a request for help: stderr + `usage`.
                writeError('abide scaffold: missing project <name>.\n')
                writeError(usage())
                process.exitCode = CLI_EXIT_CODES.usage
                return undefined
            }
            const startedAt = performance.now()
            const root = await scaffold(cwd, name)
            write(banner([{ label: 'created', value: root }], []))

            if (flagAbsent(rest, '--no-git')) await runStep(['git', 'init'], root, writeError)
            if (flagAbsent(rest, '--no-install')) {
                const installed = await runStep(['bun', 'install'], root, writeError)
                if (!installed) {
                    // Booting the dev server against an app whose deps (including abide) never
                    // installed fails deep in module resolution with a confusing stack — stop cleanly
                    // and signal failure.
                    writeError(
                        'abide scaffold: `bun install` failed — skipping the dev server. Fix the install, then run `bun run dev`.',
                    )
                    process.exitCode = CLI_EXIT_CODES.failed
                    write(hint(`next: cd ${name} && bun install && bun run dev`))
                    return undefined
                }
            }

            if (flagAbsent(rest, '--no-dev')) {
                const running = await serve(root, { dev: true, port: parsePort(rest) })
                installShutdownHandlers(running)
                write(
                    serveBanner({
                        // The one heading in the CLI: you typed `scaffold`, and what boots is a
                        // dev server.
                        heading: 'abide dev',
                        url: running.url,
                        requestedPort: running.requestedPort,
                        // The whole scaffold — write, git init, install, boot. That is what the person
                        // waited for; timing only the serve would report a number nobody experienced.
                        elapsedMilliseconds: performance.now() - startedAt,
                        notes: ['watching src/'],
                    }),
                )
                return running
            }

            write(hint(`next: cd ${name} && bun run dev`))
            return undefined
        },
    },

    // CL2. Everything the app needs is loaded (config/env validated, rpc + socket modules imported,
    // lifecycle hooks run) and nothing is served — for migrations, cron tasks, one-off maintenance.
    run: {
        invocation: 'abide run <file> [args…]',
        summary: 'run a script under the abide runtime (no HTTP; onStart/onStop run)',
        run: async ({ cwd, rest, writeError }) => {
            const file = rest[0]
            if (file === undefined) {
                writeError('abide run — usage: abide run <file> [args…]')
                process.exitCode = CLI_EXIT_CODES.usage
                return undefined
            }
            const target = isAbsolute(file) ? file : join(cwd, file)
            if (!(await Bun.file(target).exists())) {
                writeError(`abide run — no such file: ${file}`)
                process.exitCode = CLI_EXIT_CODES.usage
                return undefined
            }
            // Everything after the file is the SCRIPT's, not abide's — including anything that looks
            // like an abide flag. `abide run migrate.ts --port 5` passes `--port 5` to the migration.
            // A throw from the script itself propagates with its stack rather than becoming an exit
            // code: for a failed migration the stack IS the report.
            await run(cwd, target, rest.slice(1))
            return undefined
        },
    },

    check: {
        invocation: 'abide check',
        summary: 'type-check .abide script bodies (best-effort, via TS7)',
        run: async ({ cwd, write, writeError }) => {
            const startedAt = performance.now()
            const result = await check(cwd)
            if (result.ok) {
                write(
                    banner(
                        [],
                        [
                            'no type errors in .abide script bodies',
                            `checked in ${formatDuration(performance.now() - startedAt)}`,
                        ],
                    ),
                )
                return undefined
            }
            // The FAILURE half is deliberately left unbannered and unstyled below: those lines are
            // `file:line:column — TSxxxx: message`, which an editor and a CI log parse. Decoration
            // there would be prettier and unparseable, which is the wrong trade for the one output a
            // machine reads.
            for (const diagnostic of result.diagnostics) {
                writeError(
                    `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} — TS${diagnostic.code}: ${diagnostic.message}`,
                )
            }
            writeError(
                `\nabide check — ${result.diagnostics.length} error${result.diagnostics.length === 1 ? '' : 's'}`,
            )
            // A type error is a real failure, not a wrong command line — `failed`, not `usage`.
            process.exitCode = CLI_EXIT_CODES.failed
            return undefined
        },
    },

    lsp: {
        invocation: 'abide lsp',
        summary: 'run the .abide language server over stdio (diagnostics)',
        run: async ({ cwd }) => {
            // The tsgo `API` can't open its pipe under Bun, so by default forward stdio to
            // `node lsp.ts` (a persistent server). `bunCanHostTsgo()` flips to in-process the day Bun
            // can host it — revert = drop the forwarder branch. `ABIDE_LSP_INPROCESS=1` forces
            // in-process (for that future / testing).
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
        },
    },

    // ONE build. The executable it produces serves (`serve`), dispatches rpcs as subcommands, and
    // runs interactive — chosen when it RUNS, so there is nothing to pick here.
    compile: {
        invocation: 'abide compile',
        summary: 'build the standalone executable (app + assets embedded)',
        run: async ({ cwd, rest, write }) => {
            const startedAt = performance.now()
            // `--platforms` with no value (or a trailing flag after it) means the default release set.
            const platforms = rest.includes('--platforms')
                ? (flagValue(rest, '--platforms')?.split(',').filter(Boolean) ?? [])
                : undefined
            const built = await compile(cwd, {
                target: flagValue(rest, '--target'),
                out: flagValue(rest, '--out'),
                platforms,
            })
            // One row per artifact — `--platforms` produces a release set, and each of those paths is
            // a thing you upload, so each earns a row rather than a note.
            write(
                banner(
                    built.map((outfile) => ({ label: 'output', value: outfile })),
                    [`built in ${formatDuration(performance.now() - startedAt)}`],
                ),
            )
            return undefined
        },
    },

    bundle: {
        invocation: 'abide bundle',
        summary: 'build the desktop launcher into dist/bundle/ (host platform)',
        run: async ({ cwd, write }) => {
            const startedAt = performance.now()
            const outDir = await bundle(cwd)
            write(
                banner(
                    [
                        { label: 'output', value: outDir },
                        { label: 'run', value: `bun ${join(outDir, 'launch.ts')}` },
                    ],
                    [
                        `built in ${formatDuration(performance.now() - startedAt)}`,
                        'native windowing is best-effort (system webview binary or default browser)',
                    ],
                ),
            )
            return undefined
        },
    },
}

export async function main(
    argv: string[],
    options: MainOptions = {},
): Promise<ServeResult | undefined> {
    const command = argv[0]
    const rest = argv.slice(1)
    const cwd = options.cwd ?? process.cwd()
    const write = options.write ?? ((line: string): void => console.info(line))
    const writeError = options.writeError ?? ((line: string): void => console.error(line))

    const entry = command === undefined ? undefined : DEV_COMMANDS[command]
    if (entry !== undefined)
        return await entry.run({ rest, cwd, write, writeError, usage: usageText })

    // Asking for help is a success; getting the command wrong is not. They used to share this branch
    // and both exit 0 — so `abide biuld` in a CI script printed the usage text and reported success.
    if (command === undefined || command === '-h' || command === '--help') {
        write(usageText())
        return undefined
    }
    writeError(`abide: unknown command "${command}".\n`)
    writeError(usageText())
    process.exitCode = CLI_EXIT_CODES.usage
    return undefined
}
