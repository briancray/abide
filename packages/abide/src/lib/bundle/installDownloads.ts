import { dlopen, FFIType, type Pointer } from 'bun:ffi'

/*
Wires abide's native download delegate onto the bundle's WKWebView, so `<a
download>` clicks, blob:/data: links, and attachment responses save a real file
into the user's Downloads folder and reveal it in Finder — the bare upstream
webview sets no navigation delegate and silently drops all of these.

A no-op off macOS (the shim symbol isn't compiled into the library there) and on
macOS before 11.3 (no WKDownload API). Opened as its own short-lived handle,
mirroring installMacMenu, to keep openWebview's FFI map fully typed — a
conditional symbol there defeats Bun's argument-type inference. The delegate
attaches to the live WKWebView, so it persists after this handle closes.
*/
export function installDownloads(libPath: string, webviewHandle: Pointer | null): void {
    if (process.platform !== 'darwin') {
        return
    }
    /* abide_install_downloads exists only in abide's own webview lib. A vanilla
       ABIDE_WEBVIEW_LIB on darwin lacks it, so dlopen throws — degrade to a no-op
       (downloads simply unhandled) instead of crashing the launcher, matching the
       optional-symbol FFI binders. */
    let symbols: { abide_install_downloads: (handle: Pointer | null) => void }
    let close: () => void
    try {
        ;({ symbols, close } = dlopen(libPath, {
            abide_install_downloads: { args: [FFIType.ptr], returns: FFIType.void },
        }))
    } catch {
        return
    }
    symbols.abide_install_downloads(webviewHandle)
    close()
}
