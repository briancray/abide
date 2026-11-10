// `node:child_process` rather than `Bun.spawn`: playwright runs on node.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const REPO = new URL('../../../', import.meta.url).pathname
const CLI = join(REPO, 'packages/abide/bin/abide.ts')

/**
 * An app of `files` — paths below its root, `#src/*` resolving there — written fresh to
 * `.test-modules/<directory>`, built, and started on a free port. Answers the address the banner
 * names and the server, which the spec stops (or pauses) itself.
 *
 * A directory per playwright PROJECT is the caller's to name: a spec runs in both engines at once,
 * and two projects building into one tree is a reader catching the other's build half-written.
 */
export async function servedFixture(
    directory: string,
    files: Record<string, string>,
): Promise<{ base: string; server: ChildProcess }> {
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
    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(`${app}/${path}`), { recursive: true })
        writeFileSync(`${app}/${path}`, text)
    }
    execFileSync(
        'bun',
        [CLI, 'build', '--root', app, '--out', `${app}/.abide`],
        {
            cwd: REPO,
            encoding: 'utf8',
        },
    )
    const server = spawn(
        'bun',
        [CLI, 'start', '--root', app, '--out', `${app}/.abide`, '--port', '0'],
        { cwd: REPO, stdio: ['ignore', 'pipe', 'inherit'] },
    )
    const base = await new Promise<string>((resolve, reject) => {
        let said = ''
        server.stdout?.on('data', (chunk: Buffer) => {
            said += chunk.toString()
            // The first address the banner names, which is `Local:` — read past the color
            // playwright's `FORCE_COLOR` gives it.
            const found = /(http:\/\/localhost:\d+)/.exec(said)
            if (found !== null) resolve(found[1] as string)
        })
        server.on('exit', (code) =>
            reject(new Error(`abide start exited ${code}: ${said}`)),
        )
    })
    return { base, server }
}
