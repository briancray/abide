// AN APP BUILT AND SERVED BY THE CLI, as an author runs it — for the files whose contract only
// holds across the real process boundary: a browser's call, a cookie, a response streamed off
// `abide start`. The app is a temporary module, so `removeTemporaryModules` takes it away.

import { spawned } from '@abide/harness/gate'
import { type Compilation, servedTable } from '#server/abideModules.ts'
import { COMPILATION } from '#server/CLIENT_BUILD.ts'
import { serveBuild } from '#server/serveBuild.ts'
import { temporaryModule } from './temporaryModule.ts'

export const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

// The shell and the package every fixture needs, under `files`. No tsconfig: an app without one is
// typed against the default project (38.30), which is the path an author starting out takes.
export function appFixture(files: Record<string, string>): string {
    return temporaryModule({
        'package.json': JSON.stringify({
            name: 'fixture',
            type: 'module',
            imports: { '#src/*': './*' },
        }),
        ...files,
    })
}

export function buildApp(
    app: string,
    out = `${app}/.abide`,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return spawned(['bun', BIN, 'build', '--root', app, '--out', out])
}

// `abide start` on a built app, on a port the OS picks — answered once it has printed where.
export async function startApp(
    app: string,
    env: Record<string, string | undefined> = process.env,
    out = `${app}/.abide`,
): Promise<{ base: string; stop: () => void }> {
    const server = Bun.spawn(
        ['bun', BIN, 'start', '--root', app, '--out', out, '--port', '0'],
        // THE ENVIRONMENT AS IT STANDS, which a spawn does not take by default: bun hands a child
        // the one this process started with, so a test that set a variable would not reach it.
        { stdout: 'pipe', stderr: 'pipe', env },
    )
    // `SIGKILL`, which no handler takes: `start` catches `SIGTERM` to stop the app (37.11), and a
    // test that failed with the app mid-stop would leave the process serving.
    return {
        base: await addressOf(server),
        stop: () => server.kill('SIGKILL'),
    }
}

// The origin `abide start` or `abide dev` printed. Read rather than assumed — and a boot that fails
// says so here rather than leaving every request after it to time out against a socket nothing is on.
// `told` is the child's stderr, for a caller already reading it. A `'pipe'` nobody reads does not
// stall the child: bun drains it into memory itself — 32 MB written to stderr by a handler under
// `startApp` was answered all the same.
export async function addressOf(
    child: Bun.Subprocess,
    told: () => Promise<string> = () =>
        new Response(child.stderr as ReadableStream<Uint8Array>).text(),
): Promise<string> {
    let seen = ''
    for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
        seen += new TextDecoder().decode(chunk)
        const found = /http:\/\/[^\s]+/.exec(seen)
        if (found) return new URL(found[0]).origin
    }
    throw new Error(`abide printed no address: ${seen}${await told()}`)
}

// A one-shot script run to its end, answered with the last line it printed, parsed: the scripts a
// test spawns as a client say what they saw as one line of JSON, after whatever else they log. One
// that exits otherwise than 0 is a failure whatever it printed.
export async function lastLinePrinted<Parsed>(
    command: string[],
    options?: Parameters<typeof spawned>[1],
): Promise<Parsed> {
    const ran = await spawned(command, options)
    if (ran.exitCode !== 0)
        throw new Error(
            `\`${command.join(' ')}\` exited ${ran.exitCode}: ${ran.stdout}${ran.stderr}`,
        )
    return JSON.parse(ran.stdout.trim().split('\n').at(-1) as string) as Parsed
}

// Both, for a file that only needs the app running. `env` is the server's alone: a flag a file
// sets on `process.env` outlives the file, and reaches every app served after it in that worker.
export async function serveApp(
    files: Record<string, string>,
    env: Record<string, string | undefined> = process.env,
): Promise<{ app: string; base: string; stop: () => void }> {
    const app = appFixture(files)
    const built = await buildApp(app)
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr}`)
    return { app, ...(await startApp(app, env)) }
}

// WHAT A BUILD KEPT, read as `abide start` reads it: each `.abide` compiled and each handler file's
// face, by its path below the app.
export async function builtCompilation(
    app: string,
    out = `${app}/.abide`,
): Promise<Compilation> {
    return (await Bun.file(`${out}/${COMPILATION}`).json()) as Compilation
}

// The handler table a build wrote, served to this process as `abide start` serves it.
export async function builtHandlers(
    app: string,
    out = `${app}/.abide`,
): Promise<Awaited<ReturnType<typeof servedTable>>['handlers']> {
    await serveBuild(app, out)
    return (await servedTable(app)).handlers
}

// 16.2 — a module of handlers sharing state, as handler files: the module under the directory's
// `lib`, and one file per `export const` re-exporting that binding as its default, so the values the
// handlers share stay one module's.
export function handlerFiles(
    directory: string,
    module: string,
): Record<string, string> {
    // `''` is the app's root.
    const at = directory === '' ? '' : `${directory}/`
    const files: Record<string, string> = { [`${at}lib/handlers.ts`]: module }
    for (const [, name] of module.matchAll(/^export const (\w+)/gm))
        files[`${at}${name}.handler.ts`] =
            `import { ${name} } from './lib/handlers.ts'\n\nexport default ${name}\n`
    return files
}
