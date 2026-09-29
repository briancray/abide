// AN APP BUILT AND SERVED BY THE CLI, as an author runs it — for the files whose contract only
// holds across the real process boundary: a browser's call, a cookie, a response streamed off
// `abide start`. The app is a temporary module, so `removeTemporaryModules` takes it away.

import { temporaryModule } from './temporaryModule.ts'

export const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

// The shell and the package every fixture needs, under `files`. No tsconfig: an app without one is
// typed against the default project (38.31), which is the path an author starting out takes.
export function appFixture(files: Record<string, string>): string {
    return temporaryModule({
        'ui/app.html': `<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>`,
        'package.json': JSON.stringify({
            name: 'fixture',
            type: 'module',
            imports: { '#ui/*': './ui/*', '#server/*': './server/*' },
        }),
        ...files,
    })
}

export function buildApp(
    app: string,
    out = `${app}/.abide`,
): { exitCode: number; stderr: string } {
    const built = Bun.spawnSync([
        'bun',
        BIN,
        'build',
        '--root',
        app,
        '--out',
        out,
    ])
    return { exitCode: built.exitCode, stderr: built.stderr.toString() }
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
export async function addressOf(child: Bun.Subprocess): Promise<string> {
    let seen = ''
    for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
        seen += new TextDecoder().decode(chunk)
        const found = /http:\/\/[^\s]+/.exec(seen)
        if (found) return new URL(found[0]).origin
    }
    throw new Error(
        `abide printed no address: ${seen}${await new Response(child.stderr as ReadableStream<Uint8Array>).text()}`,
    )
}

// Both, for a file that only needs the app running.
export async function serveApp(
    files: Record<string, string>,
): Promise<{ app: string; base: string; stop: () => void }> {
    const app = appFixture(files)
    const built = buildApp(app)
    if (built.exitCode !== 0)
        throw new Error(`abide build failed: ${built.stderr}`)
    return { app, ...(await startApp(app)) }
}
