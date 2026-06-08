/*
Revision of belte's own contribution to the compiled webview library — the
native shim sources linked in beside the vendored header (e.g. belteMenu.mm)
and the flags buildWebviewLib compiles them with. It participates in the build
cache key alongside the upstream version, so changing belte's native build
selects a fresh cache path and bypasses any library built before the change.
Bump this whenever the shim sources or their compile invocation change.
*/
export const webviewBuildRevision = 9
