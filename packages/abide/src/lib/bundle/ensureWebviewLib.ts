import { buildWebviewLib } from './buildWebviewLib.ts'
import { resolveWebviewLib } from './resolveWebviewLib.ts'

/*
Build-time guarantee that a webview library exists, returning its path.
Tries plain resolution first (an explicit ABIDE_WEBVIEW_LIB, a bundle-local
copy, or a previously built cache); on a miss it compiles the vendored
header for the host (buildWebviewLib) and caches the result.

Used by `abide bundle` (bundleApp), which runs under bun on a developer's
machine — never by the compiled launcher, which only ever resolves the copy
shipped beside it and must not invoke a compiler on an end user's machine.
*/
export async function ensureWebviewLib(cwd: string = process.cwd()): Promise<string> {
    try {
        return await resolveWebviewLib(cwd)
    } catch {
        return await buildWebviewLib()
    }
}
