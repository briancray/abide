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
    const { symbols, close } = dlopen(libPath, {
        abide_install_app_menu: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    })
    const config = JSON.stringify({ appName, fileMenu, menu })
    symbols.abide_install_app_menu(webviewHandle, new TextEncoder().encode(`${config}\0`))
    close()
}
