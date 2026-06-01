import { dirname, join } from 'node:path'
import { bundleLayout } from '../shared/bundleLayout.ts'
import { webviewCachePath } from './webviewCachePath.ts'
import { webviewLibName } from './webviewLibName.ts'

/*
Locates the native webview shared library to load over FFI, without ever
compiling — this runs in the compiled launcher too, where no toolchain is
present. Resolution order:

  1. BELTE_WEBVIEW_LIB — explicit path, the escape hatch for any layout.
  2. inside a bundle — beside the launcher binary (flat layout) or in
     `../Frameworks` (macOS `.app`), so a shipped bundle is self-contained.
  3. belte's own build cache — the library compiled from the vendored
     header by buildWebviewLib (populated at build time via ensureWebviewLib).

belte ships the vendored source rather than a prebuilt binary, so the
toolchain path (`belte bundle`) calls ensureWebviewLib to build-on-miss;
this resolver only reports what already exists. Throws with
guidance when nothing resolves rather than letting dlopen fail opaquely.
*/
export async function resolveWebviewLib(cwd: string = process.cwd()): Promise<string> {
    const fromEnv = process.env.BELTE_WEBVIEW_LIB
    if (fromEnv) {
        return fromEnv
    }

    const libName = webviewLibName()

    /*
    Bundle-relative candidates. In dev `process.execPath` is the `bun`
    binary, so these miss and we fall through to the build cache; in a
    shipped bundle the launcher's own directory holds the lib (flat layout)
    or its sibling Frameworks dir (macOS `.app`) — bundleLayout knows which.
    */
    const { binDir, libDir } = bundleLayout(dirname(process.execPath))
    const bundledCandidates = [join(binDir, libName), join(libDir, libName)]
    for (const candidate of bundledCandidates) {
        if (await Bun.file(candidate).exists()) {
            return candidate
        }
    }

    const cached = webviewCachePath()
    if (await Bun.file(cached).exists()) {
        return cached
    }

    throw new Error(
        '[belte] no native webview library found. Run `belte bundle` to ' +
            'build it from the vendored source, or set BELTE_WEBVIEW_LIB to a prebuilt one.',
    )
}
