import { dlopen, FFIType } from 'bun:ffi'

/*
Binds abide_set_connected — the native flag the macOS Server menu's
validateMenuItem: reads to enable/disable Start/Disconnect. The symbol is
compiled only into the macOS lib (the Cocoa menu shim), so a failed lookup
degrades to a no-op setter rather than throwing on Linux/Windows.

The flag is a process-global, which is what lets the bundle's control server set
it from off the main thread: that server runs in a Worker because `webview_run`
blocks the main thread's JS event loop, yet the main-thread menu still reads the
same value through the shared dylib image. The returned close releases the handle.
*/
export function bindConnectedFlag(libPath: string): {
    setConnected: (connected: boolean) => void
    close: () => void
} {
    try {
        const lib = dlopen(libPath, {
            abide_set_connected: { args: [FFIType.i32], returns: FFIType.void },
        })
        return {
            setConnected: (connected) => lib.symbols.abide_set_connected(connected ? 1 : 0),
            close: () => lib.close(),
        }
    } catch {
        return { setConnected: () => {}, close: () => {} }
    }
}
