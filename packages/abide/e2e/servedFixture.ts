import { mkdirSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdir/rm of its own
import { dirname, join } from 'node:path' // bun has no path helpers of its own

import type { Subprocess } from 'bun'

const REPO = new URL('../../../', import.meta.url).pathname
const CLI = join(REPO, 'packages/abide/bin/abide.ts')

/**
 * An app of `files` — paths below its root, `#src/*` resolving there — written fresh to
 * `.test-modules/<directory>`, built, and started on a free port under `env` over this process's
 * environment. Answers the address the banner names and the server, which the spec stops (or
 * pauses) itself, and the app's root, for `startedFixture` to start it again.
 *
 * A directory per playwright PROJECT is the caller's to name: a spec runs in both engines at once,
 * and two projects building into one tree is a reader catching the other's build half-written.
 */
export async function servedFixture(
    directory: string,
    files: Record<string, string>,
    env: Record<string, string> = {},
): Promise<{ app: string; base: string; server: Subprocess }> {
    const app = join(REPO, `.test-modules/${directory}`)
    rmSync(app, { recursive: true, force: true })
    mkdirSync(app, { recursive: true })
    writeFileSync(
        `${app}/package.json`,
        JSON.stringify({
            name: `${directory}-fixture`,
            type: 'module',
            imports: { '#src/*': './*' },
        }),
    )
    writeFixture(app, files)
    await buildFixture(app)
    return { app, ...(await startedFixture(app, env)) }
}

/** Writes `files` below `app`, over what is there. */
export function writeFixture(app: string, files: Record<string, string>): void {
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(`${app}/${path}`), { recursive: true })
        writeFileSync(`${app}/${path}`, text)
    }
}

/** `abide build` over `app`, as a deploy does. */
export async function buildFixture(app: string): Promise<void> {
    await Bun.$`${process.execPath} ${CLI} build --root ${app} --out ${app}/.abide`
        .cwd(REPO)
        .quiet()
}

/**
 * `abide start` over the build `app` holds, under `env`, on `port` — `0` for a free one. A spec that
 * restarts an app on the address it had passes that address's port, since a browser keeps a service
 * worker per origin.
 */
export async function startedFixture(
    app: string,
    env: Record<string, string> = {},
    port = 0,
): Promise<{ base: string; server: Subprocess }> {
    const server = Bun.spawn(
        [
            process.execPath,
            CLI,
            'start',
            '--root',
            app,
            '--out',
            `${app}/.abide`,
            '--port',
            String(port),
        ],
        {
            cwd: REPO,
            env: { ...process.env, ...env },
            stdout: 'pipe',
            stderr: 'inherit',
        },
    )
    // The first address the banner names, which is `Local:` — read past the color playwright's
    // `FORCE_COLOR` gives it. The pipe is DRAINED after that rather than released: a server whose
    // stdout nobody reads blocks, or dies, on the next line it logs.
    const reader = server.stdout
        .pipeThrough(new TextDecoderStream())
        .getReader()
    let said = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        said += value
        const found = /(http:\/\/localhost:\d+)/.exec(said)
        if (found === null) continue
        void (async () => {
            while (!(await reader.read()).done);
        })()
        return { base: found[1] as string, server }
    }
    throw new Error(`abide start exited ${await server.exited}: ${said}`)
}
