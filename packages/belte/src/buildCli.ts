import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import type { CompileTarget } from './lib/server/runtime/types/CompileTarget.ts'
import { detectTarget } from './lib/shared/detectTarget.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import { programNameForPackage } from './lib/shared/programNameForPackage.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const DISCOVERY_ENTRY = new URL('./discoveryEntry.ts', import.meta.url).pathname
const CLI_ENTRY = new URL('./cliEntry.ts', import.meta.url).pathname

/*
Two-pass CLI binary build:

  1. Discovery: build the discovery entry into a temporary JS bundle and
     run it. It imports every rpc/socket module so defineVerb /
     defineSocket populate the registries, then prints the CLI manifest
     to stdout. The manifest is written to `dist/cli-manifest.json`.
  2. Compile: build the CLI binary via `Bun.build({ compile })`. The
     resolver plugin's `belte:cli-manifest` virtual reads the manifest
     JSON written in step 1 and splices it into the bundle.

The `thin` flag decides thin vs full (default full):
  - thin: empty `belte:cli-rpcs` virtual — no handlers bundled, the
          manifest is the only RPC surface; requires APP_URL at runtime.
  - full: `belte:cli-rpcs` emits eager imports for every rpc module so the
          verbRegistry is populated and the binary runs in-process (and
          still reaches a remote server when APP_URL is set at runtime).
`platforms` cross-compiles in either mode; thin per-platform binaries land
in `dist/cli-thin/<platform>/` (the layout the /__belte/cli download endpoint
serves), full ones in `dist/cli/<platform>/`.
*/
export async function buildCli({
    cwd = process.cwd(),
    target = detectTarget(),
    outfile,
    platforms,
    thin: thinOverride,
}: {
    cwd?: string
    target?: CompileTarget
    outfile?: string
    platforms?: CompileTarget[]
    thin?: boolean
} = {}): Promise<string[]> {
    const distDir = `${cwd}/dist`
    await Bun.$`mkdir -p ${distDir}`.quiet()
    const manifestPath = `${distDir}/cli-manifest.json`
    const discoveryOut = `${distDir}/_discovery.js`

    const svelteConfig = await loadSvelteConfig(cwd)
    const isThin = thinOverride ?? false
    const sharedPlugins = (): BunPlugin[] => [
        sveltePlugin({ generate: 'server', svelteConfig }),
        belteResolverPlugin({ cwd, target: 'server', thin: isThin }),
    ]

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
        plugins: sharedPlugins(),
    })
    if (!discoveryResult.success) {
        for (const entry of discoveryResult.logs) {
            log.error(entry)
        }
        process.exit(1)
    }

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
    belte:cli-manifest virtual + the eager rpc imports (full mode only,
    empty for thin). bun build --compile emits the standalone binary.
    When `platforms` is set, loops once per target and writes binaries
    into `dist/cli-thin/<platform>/<programName>` (thin — the layout the
    download route expects) or `dist/cli/<platform>/<programName>` (full).
    */
    const programName = await readProgramName(cwd)

    if (platforms && platforms.length > 0) {
        const platformDir = isThin ? 'cli-thin' : 'cli'
        const outPaths: string[] = []
        for (const platformTarget of platforms) {
            const shortName = platformTarget.replace(/^bun-/, '')
            const suffix = platformTarget.includes('windows') ? '.exe' : ''
            const platformOut = `${distDir}/${platformDir}/${shortName}/${programName}${suffix}`
            await Bun.$`mkdir -p ${`${distDir}/${platformDir}/${shortName}`}`.quiet()
            const result = await Bun.build({
                entrypoints: [CLI_ENTRY],
                target: 'bun',
                compile: { target: platformTarget, outfile: platformOut },
                plugins: sharedPlugins(),
            })
            if (!result.success) {
                for (const entry of result.logs) {
                    log.error(entry)
                }
                process.exit(1)
            }
            log.success(`compiled ${isThin ? 'thin' : 'full'} cli binary: ${platformOut}`)
            outPaths.push(platformOut)
        }
        return outPaths
    }

    const suffix = target.includes('windows') ? '.exe' : ''
    const outPath = outfile ?? `${distDir}/cli${suffix}`

    const cliResult = await Bun.build({
        entrypoints: [CLI_ENTRY],
        target: 'bun',
        compile: { target, outfile: outPath },
        plugins: sharedPlugins(),
    })
    if (!cliResult.success) {
        for (const entry of cliResult.logs) {
            log.error(entry)
        }
        process.exit(1)
    }

    log.success(`compiled ${isThin ? 'thin' : 'full'} cli binary: ${outPath} (target: ${target})`)
    return [outPath]
}

async function readProgramName(cwd: string): Promise<string> {
    const pkgFile = Bun.file(`${cwd}/package.json`)
    if (!(await pkgFile.exists())) {
        return 'app'
    }
    const pkg = (await pkgFile.json()) as { name?: string }
    return programNameForPackage(pkg.name)
}
