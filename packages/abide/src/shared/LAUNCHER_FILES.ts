// THE DESKTOP LAUNCHER'S FILES. Its page, which calls `onLauncher`, sits at the app's root beside the
// root layout, a name the framework finds rather than a page (23.21); the icon is a public file,
// so it is wherever the address it answers at says (36.11).

/** The `.abide` the desktop launcher renders, at the root alone. 38.80, 38.82. */
export const LAUNCHER_PAGE = 'launcher.abide'

/** The addresses of the desktop app's icon, the `.icns` first. 38.79. */
export const ICON_ADDRESSES = { icns: '/icon.icns', png: '/icon.png' } as const
