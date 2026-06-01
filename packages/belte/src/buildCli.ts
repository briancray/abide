import type { CompileTarget } from './lib/server/runtime/types/CompileTarget.ts'
import { detectTarget } from './lib/shared/detectTarget.ts'
import { exeSuffix } from './lib/shared/exeSuffix.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import { programNameForPackage } from './lib/shared/programNameForPackage.ts'
import { readPackageJson } from './lib/shared/readPackageJson.ts'
import { serverBuildPlugins } from './serverBuildPlugins.ts'

const DISCOVERY_ENTRY = new URL('./discoveryEntry.ts', import.meta.url).pathname
const CLI_ENTRY = new URL('./cliEntry.ts', import.meta.url).pathname

/*
Two-pass CLI binary build. The CLI is always a thin remote client — it
bakes in the per-rpc manifest and talks to a running server over HTTP
(APP_URL at runtime); no handler code is bundled. For an embedded
backend, `belte compile` produces the standalone server binary instead.

  1. Discovery: build the discovery entry into a temporary JS bundle and
     run it. It imports every rpc/socket module so defineVerb /
     defineSocket populate the registries, then prints the CLI manifest
     to stdout. The manifest is written to `dist/cli-manifest.json`.
  2. Compile: build the CLI binary via `Bun.build({ compile })`. The
     resolver plugin's `belte:cli-manifest` virtual reads the manifest
     JSON written in step 1 and splices it into the bundle.

`platforms` cross-compiles per target into `dist/cli-thin/<platform>/`
— the layout the /__belte/cli download endpoint serves.
*/
export async function buildCli({
    cwd = process.cwd(),
    target = detectTarget(),
    outfile,
    platforms,
}: {
    cwd?: string
    target?: CompileTarget
    outfile?: string
    platforms?: CompileTarget[]
} = {}): Promise<string[]> {
    const distDir = `${cwd}/dist`
    await Bun.$`mkdir -p ${distDir}`.quiet()
    const manifestPath = `${distDir}/cli-manifest.json`
    const discoveryOut = `${distDir}/_discovery.js`

    const svelteConfig = await loadSvelteConfig(cwd)
    const plugins = serverBuildPlugins({ cwd, svelteConfig })

    /*
    Step 1 — discovery. Build a runnable bundle, execute it under bun,
    capture stdout. We don't `bun build --compile` here because the
    discovery output is throwaway; a plain JS bundle runs faster.
    */
    const discoveryResult = await Bun.build({
        entrypoints: [DISCOVERY_ENTRY],
        target: 'bun',
        outdir: distDir,
        naming: '_discovery.js',
        plugins,
    })
    exitOnBuildFailure(discoveryResult)

    const proc = Bun.spawn({
        cmd: ['bun', discoveryOut],
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    if (exitCode !== 0) {
        log.error(`discovery exited ${exitCode}:\n${stderr}`)
        process.exit(1)
    }
    await Bun.write(manifestPath, stdout)
    await Bun.$`rm -f ${discoveryOut}`.quiet()
    const entryCount = Object.keys(JSON.parse(stdout) as Record<string, unknown>).length
    log.info(`discovered ${entryCount} cli commands → ${manifestPath}`)

    /*
    Step 2 — compile. The cliEntry imports the now-populated
    belte:cli-manifest virtual; bun build --compile emits the standalone
    binary. When `platforms` is set, loops once per target and writes
    binaries into `dist/cli-thin/<platform>/<programName>` — the layout
    the download route expects.
    */
    const programName = await readProgramName(cwd)

    if (platforms && platforms.length > 0) {
        // Cross-compile every target in parallel — each build is independent.
        return Promise.all(
            platforms.map(async (platformTarget) => {
                const shortName = platformTarget.replace(/^bun-/, '')
                const suffix = exeSuffix(platformTarget)
                const platformOut = `${distDir}/cli-thin/${shortName}/${programName}${suffix}`
                await Bun.$`mkdir -p ${`${distDir}/cli-thin/${shortName}`}`.quiet()
                const result = await Bun.build({
                    entrypoints: [CLI_ENTRY],
                    target: 'bun',
                    compile: { target: platformTarget, outfile: platformOut },
                    plugins,
                })
                exitOnBuildFailure(result)
                log.success(`compiled thin cli binary: ${platformOut}`)
                return platformOut
            }),
        )
    }

    const suffix = exeSuffix(target)
    const outPath = outfile ?? `${distDir}/cli${suffix}`

    const cliResult = await Bun.build({
        entrypoints: [CLI_ENTRY],
        target: 'bun',
        compile: { target, outfile: outPath },
        plugins,
    })
    exitOnBuildFailure(cliResult)

    log.success(`compiled thin cli binary: ${outPath} (target: ${target})`)
    return [outPath]
}

async function readProgramName(cwd: string): Promise<string> {
    const pkg = (await readPackageJson(cwd)) as { name?: string } | undefined
    return programNameForPackage(pkg?.name)
}
