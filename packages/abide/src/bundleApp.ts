import { dirname } from 'node:path'
import { buildDisconnected } from './buildDisconnected.ts'
import { compile } from './compile.ts'
import { ensureWebviewLib } from './lib/bundle/ensureWebviewLib.ts'
import { infoPlist } from './lib/bundle/infoPlist.ts'
import { pngToIcns } from './lib/bundle/pngToIcns.ts'
import { serverBinaryFilename } from './lib/bundle/serverBinaryFilename.ts'
import { signMacApp } from './lib/bundle/signMacApp.ts'
import { webviewLibName } from './lib/bundle/webviewLibName.ts'
import { abideLog } from './lib/shared/abideLog.ts'
import { bundleLayout } from './lib/shared/bundleLayout.ts'
import { detectTarget } from './lib/shared/detectTarget.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { programNameForPackage } from './lib/shared/programNameForPackage.ts'
import { readPackageJson } from './lib/shared/readPackageJson.ts'
import { serverBuildPlugins } from './serverBuildPlugins.ts'

const APP_ENTRY = new URL('./appEntry.ts', import.meta.url).pathname
const WORKER_ENTRY = new URL('./controlServerWorker.ts', import.meta.url).pathname

/*
Assembles a movable, self-contained app bundle for the host platform —
no cross-compilation, and on macOS an ad-hoc seal so it launches on other
Macs (signMacApp). Three pieces travel together so the app runs on another
machine of the same OS with nothing installed:

  - the standalone server binary (`compile()`, assets embedded)
  - the launcher binary (appEntry — spawns the server, opens the webview)
  - the native webview shared library

macOS gets a `.app` bundle (`Contents/MacOS/` + `Contents/Frameworks/` +
Info.plist); other platforms get a flat `<name>/` directory with the two
binaries and the lib side by side. The launcher finds both relatives at
runtime via resolveServerBinary / resolveWebviewLib.
*/
export async function bundleApp({ cwd = process.cwd() }: { cwd?: string } = {}): Promise<string> {
    const target = detectTarget()
    const { name, version } = await readPackage(cwd)
    const programName = programNameForPackage(name)

    /*
    Layout differs by OS: a macOS .app nests binaries under Contents/MacOS, the
    lib under Contents/Frameworks, and data under Contents/Resources; elsewhere
    everything sits flat in one directory. bundleLayout derives the rest from
    binDir — the same source the boot readers resolve from — so build and runtime
    agree on where the lib, resources, and shipped `.env` land.
    */
    const isMac = process.platform === 'darwin'
    const bundleRoot = isMac ? `${cwd}/dist/${programName}.app` : `${cwd}/dist/${programName}`
    const binDir = isMac ? `${bundleRoot}/Contents/MacOS` : bundleRoot
    const { libDir, resourcesDir, envPath } = bundleLayout(binDir)

    await Bun.$`rm -rf ${bundleRoot}`.quiet()
    await Bun.$`mkdir -p ${binDir} ${libDir}`.quiet()

    // 1. Server binary — self-contained, embeds the client assets. compile()
    // runs the client build, which clears dist first, so it must precede the
    // connect-screen build that writes into dist.
    await compile({ cwd, target, outfile: `${binDir}/${serverBinaryFilename()}` })

    /*
    Opt-in: ship the project's `bundle.env` as the shipped `.env`, which the
    server loads at boot (loadEnvFromBinaryDir) as its default config layer. A
    dedicated file, never the working `.env` — a compiled bundle is extractable,
    so only ship-safe defaults belong here; user-specific/secret values come from
    the data-dir `.env` instead. Named outside Bun's `.env.*` autoload family on
    purpose: it's a build input, not a runtime overlay, so `bun dev`/`bun start`
    never pick it up. bundleLayout places it under Contents/Resources
    in a macOS `.app` (sealed as a resource, so it survives codesign) and beside
    the binaries otherwise. Skipped when absent.
    */
    const bundleEnv = Bun.file(`${cwd}/bundle.env`)
    if (await bundleEnv.exists()) {
        await Bun.$`mkdir -p ${dirname(envPath)}`.quiet()
        await Bun.write(envPath, bundleEnv)
    }

    // 2. Connect screen — bake dist/bundle-disconnected.html before the launcher
    // build, which inlines it via the abide:bundle-disconnected virtual.
    await buildDisconnected({ cwd })

    // 3. Launcher binary — named after the program so CFBundleExecutable matches.
    const launcherSuffix = target.includes('windows') ? '.exe' : ''
    const launcherPath = `${binDir}/${programName}${launcherSuffix}`
    const launcherResult = await Bun.build({
        entrypoints: [APP_ENTRY],
        target: 'bun',
        compile: { target, outfile: launcherPath },
        plugins: serverBuildPlugins({ cwd }),
        /*
        Inject the worker's absolute path as a static literal. `new Worker()` is
        embedded into the standalone binary only when its specifier is a build-time
        literal, and a relative one would resolve against `cwd` (the consumer
        project) rather than appEntry's directory — so the launcher passes the
        absolute path through this define instead.
        */
        define: { __ABIDE_WORKER_ENTRY__: JSON.stringify(WORKER_ENTRY) },
    })
    exitOnBuildFailure(launcherResult)

    // 4. Webview lib — built from the vendored source if needed, then copied
    // beside the binaries (or into Frameworks on macOS) so the bundle is self-contained.
    const libSource = await ensureWebviewLib(cwd)
    await Bun.write(`${libDir}/${webviewLibName()}`, Bun.file(libSource))

    /*
    macOS-only: produce Contents/Resources/icon.icns from an optional project
    icon, then write the Info.plist that makes the .app launchable from
    Finder, wiring CFBundleIconFile when an icon was produced. A ready-made
    src/bundle/icon.icns is used as-is; otherwise src/bundle/icon.png is
    converted via sips + iconutil so authors don't need to make an .icns.
    */
    if (isMac) {
        const icnsSource = `${cwd}/src/bundle/icon.icns`
        const pngSource = `${cwd}/src/bundle/icon.png`
        let hasIcon = false
        if (await Bun.file(icnsSource).exists()) {
            await Bun.$`mkdir -p ${resourcesDir}`.quiet()
            await Bun.write(`${resourcesDir}/icon.icns`, Bun.file(icnsSource))
            hasIcon = true
        } else if (await Bun.file(pngSource).exists()) {
            await Bun.$`mkdir -p ${resourcesDir}`.quiet()
            hasIcon = await pngToIcns(pngSource, `${resourcesDir}/icon.icns`)
        }
        await Bun.write(
            `${bundleRoot}/Contents/Info.plist`,
            infoPlist({ name: programName, version, icon: hasIcon ? 'icon' : undefined }),
        )

        // Seal the finished bundle so it launches on other Macs — must run last,
        // after every binary, the lib, and Info.plist are in place.
        await signMacApp(bundleRoot, [
            `${libDir}/${webviewLibName()}`,
            `${binDir}/${serverBinaryFilename()}`,
            launcherPath,
        ])
    }

    abideLog.success(`bundled app: ${bundleRoot} (target: ${target})`)
    return bundleRoot
}

// Reads name + version from package.json, with fallbacks when absent.
async function readPackage(cwd: string): Promise<{ name: string | undefined; version: string }> {
    const pkg = (await readPackageJson(cwd)) as { name?: string; version?: string } | undefined
    return { name: pkg?.name, version: pkg?.version ?? '0.0.0' }
}
