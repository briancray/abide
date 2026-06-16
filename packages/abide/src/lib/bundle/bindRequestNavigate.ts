import { dlopen, FFIType, type Pointer } from 'bun:ffi'

/*
Binds abide_request_navigate — points the live webview window at a URL from any
thread by hopping onto the UI thread via webview_dispatch. The launcher's control
server runs in a Worker (off the main thread that webview_run blocks), so when it
detects the connected server has died it uses this to bounce the window back to the
connect screen. macOS-only symbol (the Cocoa shim), so a failed lookup degrades to
a no-op — elsewhere the worker can still correct the menu flag, just not the window.

`handle` is the webview pointer created on the main thread, forwarded to the worker
as a number; bun:ffi accepts it for a ptr argument from either thread because the
pointer addresses the same process heap.
*/
export function bindRequestNavigate(libPath: string): {
    requestNavigate: (handle: number, url: string) => void
    close: () => void
} {
    try {
        const lib = dlopen(libPath, {
            abide_request_navigate: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
        })
        return {
            requestNavigate: (handle, url) =>
                lib.symbols.abide_request_navigate(
                    handle as Pointer,
                    new TextEncoder().encode(`${url}\0`),
                ),
            close: () => lib.close(),
        }
    } catch {
        return { requestNavigate: () => {}, close: () => {} }
    }
}
