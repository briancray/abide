import { dlopen, FFIType, type Pointer } from 'bun:ffi'
import type { BundleMenu } from './BundleMenu.ts'

/*
Installs the macOS application menu bar via abide's native shim in the webview
library. The standard App/Edit/Window menus are always present — so Cmd-Q and the
Edit shortcuts (Cmd-C/V/X/A/Z) work, which the bare upstream webview window lacks
— plus the launcher's `fileMenu` (inserted as File, before Edit) and the bundle's
custom `menu` (between Edit and Window). Menu items are serialised as
`{ separator: true }`, `{ label, shortcut?, navigate, role? }`, or
`{ label, shortcut?, emit }`: `navigate` items repoint the live window (the
launcher's File menu uses these, with `role` gating their enabled state against the
native connected flag set by `abide_set_connected`), `emit` items dispatch
`abide:menu` events into the page. `appName` labels the App-menu items.

The config is serialised to JSON and parsed natively, so the launcher never
touches FFI. A no-op off macOS, where the shim symbol isn't compiled into the
library; opened as its own short-lived handle to keep openWebview's FFI map
fully typed (a conditional symbol there defeats Bun's argument-type inference).
The native menu attaches to the shared NSApplication, so it persists after this
handle closes.
*/
export function installMacMenu(
    libPath: string,
    webviewHandle: Pointer | null,
    appName: string,
    menu: BundleMenu[] | undefined,
    fileMenu: BundleMenu | undefined,
): void {
    if (process.platform !== 'darwin') {
        return
    }
    /* The abide_install_app_menu symbol is compiled only into abide's own webview lib.
       A user who points ABIDE_WEBVIEW_LIB at a vanilla webview.dylib is on darwin but
       lacks the symbol, so dlopen throws — degrade to a no-op (native menu simply absent)
       rather than crashing the launcher, matching bindConnectedFlag/bindRequestNavigate. */
    let symbols: { abide_install_app_menu: (handle: Pointer | null, config: Uint8Array) => void }
    let close: () => void
    try {
        ;({ symbols, close } = dlopen(libPath, {
            abide_install_app_menu: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
        }))
    } catch {
        return
    }
    const config = JSON.stringify({ appName, fileMenu, menu })
    symbols.abide_install_app_menu(webviewHandle, new TextEncoder().encode(`${config}\0`))
    close()
}
