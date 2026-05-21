import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { build } from './build.ts'
import { detectTarget } from './lib/shared/detectTarget.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import type { CompileTarget } from './lib/types/CompileTarget.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const SERVER_ENTRY = new URL('./serverEntry.ts', import.meta.url).pathname

/*
Produces a standalone Bun executable for the server. Runs the client `build`
first so the resolver plugin can embed the gzipped assets into the binary,
then invokes Bun.build in compile mode against the server entry. Defaults
the target to the host platform and appends `.exe` for windows targets.
Returns the path of the emitted binary; exits the process on build failure.
*/
export async function compile({
    cwd = process.cwd(),
    target = detectTarget(),
    outfile,
}: {
    cwd?: string
    target?: CompileTarget
    outfile?: string
} = {}): Promise<string> {
    const svelteConfig = await loadSvelteConfig(cwd)
    await build({ cwd, svelteConfig })

    const outPath = outfile ?? `${cwd}/dist/server${target.includes('windows') ? '.exe' : ''}`

    const plugins: BunPlugin[] = [
        sveltePlugin({ generate: 'server', svelteConfig }),
        belteResolverPlugin({ cwd, embedAssets: true }),
    ]

    const result = await Bun.build({
        entrypoints: [SERVER_ENTRY],
        target: 'bun',
        compile: { target, outfile: outPath },
        plugins,
    })

    if (!result.success) {
        for (const entry of result.logs) {
            log.error(entry)
        }
        process.exit(1)
    }

    log.success(`compiled standalone binary: ${outPath} (target: ${target})`)
    return outPath
}
