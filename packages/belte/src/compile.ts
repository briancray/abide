import { build } from './build.ts'
import { detectTarget } from './lib/shared/detectTarget.ts'
import { exeSuffix } from './lib/shared/exeSuffix.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import type { CompileTarget } from './lib/shared/types/CompileTarget.ts'
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
    buildClient = true,
}: {
    cwd?: string
    target?: CompileTarget
    outfile?: string
    /*
    Skip the client `build` (which clears dist). Set false when the caller already
    built the platform-independent client once and is compiling several server
    binaries against it — e.g. `belte cli` co-shipping a per-platform server beside
    each CLI binary — so the shared `dist/_app` isn't wiped between targets.
    */
    buildClient?: boolean
} = {}): Promise<string> {
    const svelteConfig = await loadSvelteConfig(cwd)
    if (buildClient) {
        await build({ cwd, svelteConfig })
    }

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
