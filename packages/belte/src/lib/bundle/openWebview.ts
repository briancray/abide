import { dlopen, FFIType, type Pointer } from 'bun:ffi'
import type { BundleMenu } from './BundleMenu.ts'
import { installDownloads } from './installDownloads.ts'
import { installMacMenu } from './installMacMenu.ts'
import { resolveWebviewLib } from './resolveWebviewLib.ts'

// WEBVIEW_HINT_NONE — the window is freely resizable (the only hint we need).
const WEBVIEW_HINT_NONE = 0

/*
Encodes a string as a NUL-terminated UTF-8 buffer for the C ABI. bun:ffi
passes a TypedArray to a `ptr` argument as a raw pointer, and the webview
C functions expect NUL-terminated `const char *`.
*/
function cString(value: string): Uint8Array {
    return new TextEncoder().encode(`${value}\0`)
}

/*
Opens a native OS webview window pointed at `url` and blocks until the
user closes it. This drives the platform UI run loop (WebKit on macOS,
WebView2 on Windows, WebKitGTK on Linux) via FFI against the webview C
library — no Chromium is bundled. Because `webview_run` enters a blocking
native event loop on the calling thread, the belte server must already be
running in a separate process; this call owns the main thread until the
window closes, then destroys the handle and releases the library.
*/
export async function openWebview({
    url,
    title,
    width = 1024,
    height = 768,
    menu,
    fileMenu,
    onWindow,
}: {
    url: string
    title: string
    width?: number
    height?: number
    menu?: BundleMenu[]
    // The File menu, inserted before Edit — the launcher's Start/Disconnect.
    fileMenu?: BundleMenu
    /*
    Hands back the window handle once it exists, before the run loop blocks the
    thread. The launcher forwards it to its control-server worker so the worker
    can navigate the window from off-thread (e.g. bounce back to the connect
    screen when the connected server dies).
    */
    onWindow?: (handle: Pointer | null) => void
}): Promise<void> {
    const libPath = await resolveWebviewLib()
    const { symbols, close } = dlopen(libPath, {
        webview_create: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
        webview_set_title: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
        webview_set_size: {
            args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.i32],
            returns: FFIType.void,
        },
        webview_navigate: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
        webview_run: { args: [FFIType.ptr], returns: FFIType.void },
        webview_destroy: { args: [FFIType.ptr], returns: FFIType.void },
    })

    // The second arg is an optional parent window handle; null means a fresh window.
    const handle = symbols.webview_create(0, null)
    symbols.webview_set_title(handle, cString(title))
    symbols.webview_set_size(handle, width, height, WEBVIEW_HINT_NONE)
    /*
    Install the macOS menu bar (no-op off macOS) after the application exists
    but before the run loop starts, so Quit and the Edit shortcuts work — the
    upstream webview omits the menu entirely — plus the bundle's custom menus.
    */
    installMacMenu(libPath, handle, title, menu, fileMenu)
    /*
    Attach the download delegate (no-op off macOS / before 11.3) before the
    first navigation, so `<a download>`, blob/data links, and attachment
    responses save a file instead of being silently dropped by the bare webview.
    */
    installDownloads(libPath, handle)
    onWindow?.(handle)

    symbols.webview_navigate(handle, cString(url))
    // Blocks here, running the native UI loop, until the window is closed.
    symbols.webview_run(handle)
    symbols.webview_destroy(handle)
    close()
}
