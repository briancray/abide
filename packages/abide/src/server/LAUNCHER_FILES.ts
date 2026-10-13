// THE DESKTOP LAUNCHER'S FILES. Its page and the `launcher` options it exports sit at the app's root
// beside the root layout, a name the framework finds rather than an address (23.14); the icon is a
// public file, so it is wherever the address it answers at says (36.11).

/** The launcher's page and options. 38.80, 38.82. */
export const LAUNCHER_PAGE = 'launcher.abide'

/** The addresses of the desktop app's icon, the `.icns` first. 38.79. */
export const ICON_ADDRESSES = { icns: '/icon.icns', png: '/icon.png' } as const
