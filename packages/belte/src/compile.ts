import { build } from './build.ts'
import type { CompileTarget } from './lib/server/runtime/types/CompileTarget.ts'
import { detectTarget } from './lib/shared/detectTarget.ts'
import { exeSuffix } from './lib/shared/exeSuffix.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import { serverBuildPlugins } from './serverBuildPlugins.ts'

const SERVER_ENTRY = new URL('./serverEntry.ts', import.meta.url).pathname

/*
Produces a standalone Bun executable for the server. Runs the client `build`
first so the resolver plugin can embed the zstd-compressed assets into
the binary, then invokes Bun.build in compile mode against the server
entry. Defaults
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

    const outPath = outfile ?? `${cwd}/dist/app${exeSuffix(target)}`

    const result = await Bun.build({
        entrypoints: [SERVER_ENTRY],
        target: 'bun',
        format: 'esm',
        minify: true,
        /*
        Bytecode embeds precompiled JS module metadata directly into the
        standalone binary, dramatically cutting cold-start time for large
        apps. Requires `target: 'bun'` + an explicit `format` because the
        default for `bytecode` alone is CommonJS; we need ESM bytecode.
        */
        bytecode: true,
        compile: { target, outfile: outPath },
        plugins: serverBuildPlugins({ cwd, svelteConfig, embedAssets: true }),
    })

    exitOnBuildFailure(result)

    log.success(`compiled standalone binary: ${outPath} (target: ${target})`)
    return outPath
}
