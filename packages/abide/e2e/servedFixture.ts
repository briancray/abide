import { mkdirSync, rmSync, writeFileSync } from 'node:fs' // bun has no sync mkdir/rm of its own
import { dirname, join } from 'node:path' // bun has no path helpers of its own

import type { Subprocess } from 'bun'

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
): Promise<{ base: string; server: Subprocess }> {
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
    await Bun.$`${process.execPath} ${CLI} build --root ${app} --out ${app}/.abide`
        .cwd(REPO)
        .quiet()
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
            '0',
        ],
        { cwd: REPO, stdout: 'pipe', stderr: 'inherit' },
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
