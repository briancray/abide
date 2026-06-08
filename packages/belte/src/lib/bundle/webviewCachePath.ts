import { join } from 'node:path'
import { WEBVIEW_BUILD_REVISION } from './WEBVIEW_BUILD_REVISION.ts'
import { WEBVIEW_VERSION } from './WEBVIEW_VERSION.ts'
import { webviewLibName } from './webviewLibName.ts'

/*
Absolute path where the locally built webview library is cached. belte
compiles the vendored `native/webview.h` once per host and reuses the
result; both buildWebviewLib (the writer) and resolveWebviewLib (a reader)
derive the location here so they never drift.

The cache sits next to the vendored source inside the belte package, so it
is shared across every project on the machine that uses this belte install
and survives independently of any consumer's `cwd`. Namespacing by
platform + arch + upstream version keeps a single cache correct across
architectures and makes a header bump — or a belte native-build bump — select
a fresh path automatically.
*/
export function webviewCachePath(): string {
    const nativeDir = new URL('./native', import.meta.url).pathname
    const key = `${process.platform}-${process.arch}-${WEBVIEW_VERSION}-${WEBVIEW_BUILD_REVISION}`
    return join(nativeDir, '.cache', key, webviewLibName())
}
