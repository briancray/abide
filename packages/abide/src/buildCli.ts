import { dirname, join } from 'node:path'
import { build } from './build.ts'
import { compile } from './compile.ts'
import { abideLog } from './lib/shared/abideLog.ts'
import { detectTarget } from './lib/shared/detectTarget.ts'
import { exeSuffix } from './lib/shared/exeSuffix.ts'
import { buildArtifact } from './lib/shared/buildArtifact.ts'
import { programNameForPackage } from './lib/shared/programNameForPackage.ts'
import { readPackageJson } from './lib/shared/readPackageJson.ts'
import type { CompileTarget } from './lib/shared/types/CompileTarget.ts'
import { serverBuildPlugins } from './serverBuildPlugins.ts'

const DISCOVERY_ENTRY = new URL('./discoveryEntry.ts', import.meta.url).pathname
const CLI_ENTRY = new URL('./cliEntry.ts', import.meta.url).pathname

/*
CLI binary build. The CLI is a thin remote client — it bakes in the per-rpc
manifest and talks to a running server over HTTP — but the **full** binary ships
the compiled server beside it, so `/start` can spawn a local instance.

  1. Client build (once): `build` produces the platform-independent `dist/_app`
     the server binaries embed. It clears dist first, so it runs before everything.
  2. Discovery: build the discovery entry into a temporary JS bundle and run it. It
     imports every rpc/socket module so defineRpc / defineSocket populate the
     registries, then prints the CLI manifest to stdout → `dist/cli-manifest.json`.
  3. Per target: a server binary (`compile`, reusing the shared `dist/_app` via
     `buildClient:false`) plus the CLI binary, written side by side. The resolver's
     `abide:cli-manifest` virtual splices in the manifest from step 2.

`platforms` cross-compiles per target into `dist/cli-thin/<platform>/` (the layout
the /__abide/cli download endpoint serves): `<programName>` + `server` together.
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
    const manifestPath = `${distDir}/cli-manifest.json`
    const discoveryOut = `${distDir}/_discovery.js`

    const plugins = serverBuildPlugins({ cwd })

    // Step 1 — client build once (clears dist, writes _app). Every server binary
    // embeds it, so it must precede discovery and the per-target compiles.
    await build({ cwd })

    /*
    Step 2 — discovery. Build a runnable bundle, execute it under bun, capture
    stdout. We don't `bun build --compile` here because the discovery output is
    throwaway; a plain JS bundle runs faster. Additive — does not clear dist.
    */
    await buildArtifact({
        entrypoints: [DISCOVERY_ENTRY],
        target: 'bun',
        outdir: distDir,
        naming: '_discovery.js',
        plugins,
    })

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
        abideLog.error(`discovery exited ${exitCode}:\n${stderr}`)
        process.exit(1)
    }
    await Bun.write(manifestPath, stdout)
    await Bun.$`rm -f ${discoveryOut}`.quiet()
    const entryCount = Object.keys(JSON.parse(stdout) as Record<string, unknown>).length
    abideLog.info(`discovered ${entryCount} cli commands → ${manifestPath}`)

    const programName = await readProgramName(cwd)

    /*
    Step 3 — compile a CLI binary + sibling server binary for a single target,
    written side by side so `resolveServerBinary()` finds the server next to the
    running CLI. The server reuses the shared client build (buildClient:false).
    */
    async function buildTargetPair(platformTarget: CompileTarget, cliOut: string): Promise<string> {
        const serverOut = join(dirname(cliOut), `server${exeSuffix(platformTarget)}`)
        await compile({ cwd, target: platformTarget, outfile: serverOut, buildClient: false })
        await buildArtifact({
            entrypoints: [CLI_ENTRY],
            target: 'bun',
            compile: { target: platformTarget, outfile: cliOut },
            plugins,
        })
        abideLog.success(`compiled cli + server: ${cliOut}`)
        return cliOut
    }

    if (platforms && platforms.length > 0) {
        // Cross-compile every target in parallel — each pair is independent.
        return Promise.all(
            platforms.map(async (platformTarget) => {
                const shortName = platformTarget.replace(/^bun-/, '')
                const cliOut = `${distDir}/cli-thin/${shortName}/${programName}${exeSuffix(platformTarget)}`
                await Bun.$`mkdir -p ${`${distDir}/cli-thin/${shortName}`}`.quiet()
                return buildTargetPair(platformTarget, cliOut)
            }),
        )
    }

    const cliOut = outfile ?? `${distDir}/cli${exeSuffix(target)}`
    return [await buildTargetPair(target, cliOut)]
}

async function readProgramName(cwd: string): Promise<string> {
    const pkg = (await readPackageJson(cwd)) as { name?: string } | undefined
    return programNameForPackage(pkg?.name)
}
