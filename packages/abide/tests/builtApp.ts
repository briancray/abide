// AN APP BUILT AND SERVED BY THE CLI, as an author runs it — for the files whose contract only
// holds across the real process boundary: a browser's call, a cookie, a response streamed off
// `abide start`. The app is a temporary module, so `removeTemporaryModules` takes it away.

import { temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

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

export function buildApp(app: string): { exitCode: number; stderr: string } {
    const built = Bun.spawnSync([
        'bun',
        BIN,
        'build',
        '--root',
        app,
        '--out',
        `${app}/.abide`,
    ])
    return { exitCode: built.exitCode, stderr: built.stderr.toString() }
}

// `abide start` on a built app, on a port the OS picks — answered once it has printed where.
export async function startApp(
    app: string,
): Promise<{ base: string; stop: () => void }> {
    const server = Bun.spawn(
        [
            'bun',
            BIN,
            'start',
            '--root',
            app,
            '--out',
            `${app}/.abide`,
            '--port',
            '0',
        ],
        // THE ENVIRONMENT AS IT STANDS, which a spawn does not take by default: bun hands a child
        // the one this process started with, so a test that set a variable would not reach it.
        { stdout: 'pipe', stderr: 'pipe', env: process.env },
    )
    let seen = ''
    for await (const chunk of server.stdout as ReadableStream<Uint8Array>) {
        seen += new TextDecoder().decode(chunk)
        const found = /http:\/\/[^\s]+/.exec(seen)
        if (found)
            return { base: new URL(found[0]).origin, stop: () => server.kill() }
    }
    throw new Error(`abide start printed no address: ${seen}`)
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
