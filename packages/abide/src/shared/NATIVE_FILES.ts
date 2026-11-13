// THE NATIVE APP'S FILES. Its pages sit in the root's `native` directory, a fence (23.15) whose
// files the framework finds by name rather than by route; the icons are public files, so they are
// wherever the address they answer at says (36.11).

/** The root's fence for the native app's own pages. 23.33. */
export const NATIVE_DIRECTORY = 'native'

/** The `.abide` the native launcher renders. 38.80, 38.82. */
export const LAUNCHER_PAGE = `${NATIVE_DIRECTORY}/launcher.abide`

/** The `.abide` the menu bar extra's panel shows. 38.167. */
export const MENU_BAR_PAGE = `${NATIVE_DIRECTORY}/menubar.abide`

/** The addresses of the native app's icon, the `.icns` first. 38.79. */
export const ICON_ADDRESSES = { icns: '/icon.icns', png: '/icon.png' } as const

/** 38.166 — the public file the menu bar extra is drawn from, as a template image. */
export const MENU_BAR_ICON_ADDRESS = '/icon-menubar.png'
