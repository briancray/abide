// `abide bundle` — the desktop bundle launcher (BU1-4, MVP).
//
// A MODULE rather than a function body inside `main.ts`, for the reason `build.ts` already states for
// itself: `main.ts` is the CLI DISPATCHER, and this is a build step. That extraction stopped at
// `build`, and the consequence it predicts had already landed here — `bundle/bundle.test.ts` imports
// this from `../cli/main.ts`, so testing a launcher writer dragged in `serve`, `compile`, `run`,
// `installShutdownHandlers` and the starter-template constants.

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BundleWindow } from '../bundle/BundleWindow.ts'
import { build } from './build.ts'
import { bundleLauncher } from './bundleLauncher.ts'

// Read the optional declarative window config (BU3) from `src/bundle/window.ts` if present. Returns
// the default export (a BundleWindow) or an empty config when the file is absent. Dynamic-imported so
// a project without a bundle window still bundles.
async function loadBundleWindow(dir: string): Promise<BundleWindow> {
    const path = join(dir, 'src', 'bundle', 'window.ts')
    if (!(await Bun.file(path).exists())) return {}
    const module = (await import(path)) as { default?: BundleWindow }
    return module.default ?? {}
}

// Build the desktop bundle launcher (BU1-4, MVP). Builds the client bundle (fails loud on a broken
// app), reads the declarative BundleWindow, and writes a self-contained launcher script under
// dist/bundle/. The launcher — not this build step — is what opens the window, so `abide bundle`
// never spawns UI. Host-platform only (BU1.3). Returns the absolute output dir.
export async function bundle(dir: string): Promise<string> {
    await build(dir)
    const window = await loadBundleWindow(dir)

    const outDir = join(dir, 'dist', 'bundle')
    await mkdir(outDir, { recursive: true })
    await Bun.write(join(outDir, 'window.json'), JSON.stringify(window, null, 2))
    await Bun.write(join(outDir, 'launch.ts'), bundleLauncher(window))
    return outDir
}
