import { mkdirSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdir/rm of its own
import { dirname, join } from 'node:path' // bun has no path helpers of its own

import type { Subprocess } from 'bun'

import { addressOf } from '../tests/builtApp.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const cliOf = (repo: string): string =>
    join(repo, 'packages/abide/bin/abide.ts')

/**
 * An app of `files` — paths below its root, `#src/*` resolving there — written fresh to
 * `.test-modules/<directory>`, built, and started on a free port under `env` over this process's
 * environment. Answers the address the banner names and the server, which the spec stops (or
 * pauses) itself, and the app's root, for `startedFixture` to start it again.
 *
 * A directory per playwright PROJECT is the caller's to name: a spec runs in both engines at once,
 * and two projects building into one tree is a reader catching the other's build half-written.
 *
 * `repo` is the checkout whose CLI builds and serves it, and whose `.test-modules` it is written to,
 * so `@abide/abide` resolves to that checkout's framework — a bench comparing two checkouts.
 */
export async function servedFixture(
    directory: string,
    files: Record<string, string>,
    env: Record<string, string> = {},
    repo = REPO,
): Promise<{ app: string; base: string; server: Subprocess }> {
    const app = join(repo, `.test-modules/${directory}`)
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
    await buildFixture(app, repo)
    return { app, ...(await startedFixture(app, env, 0, repo)) }
}

/** Writes `files` below `app`, over what is there. */
export function writeFixture(app: string, files: Record<string, string>): void {
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(`${app}/${path}`), { recursive: true })
        writeFileSync(`${app}/${path}`, text)
    }
}

/** `abide build` over `app`, as a deploy does. */
export async function buildFixture(app: string, repo = REPO): Promise<void> {
    await Bun.$`${process.execPath} ${cliOf(repo)} build --root ${app} --out ${app}/.abide`
        .cwd(repo)
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
    repo = REPO,
): Promise<{ base: string; server: Subprocess }> {
    const server = Bun.spawn(
        [
            process.execPath,
            cliOf(repo),
            'start',
            '--root',
            app,
            '--out',
            `${app}/.abide`,
            '--port',
            String(port),
        ],
        {
            cwd: repo,
            env: { ...process.env, ...env },
            stdout: 'pipe',
            stderr: 'inherit',
        },
    )
    // stderr is inherited, so there is nothing for a failed boot to add from it.
    return {
        base: await addressOf(server, () => Promise.resolve('')),
        server,
    }
}
