// 16.11, 36.11 — WHERE THE APP IS MOUNTED, read at run time and never baked into a build: a browser
// reads it from the `<meta>` the document carries, and a server from `config().APP_URL`, which fills
// the slot. `''` is the root.
//
// EVERY ABSOLUTE ADDRESS abide produces goes through `mounted`, and every one it matches through
// `unmounted`, so an app that has never thought about a sub-path already serves under one.

import { MOUNT_META } from './MOUNT_META.ts'

export const MOUNT: { current: () => string } = { current: documentMount }

// READ ONCE PER DOCUMENT. A document abide did not render carries no `<meta>`, and a selector that
// finds nothing has walked the whole document to say so — `url()` in a `{#for}` row paid that per
// row, 10.3 ms against 1.4 ms for a 1000-row build in chromium. The server writes the tag ahead of
// the script, so the first read already sees the answer every later one would.
let documentMountRead: string | undefined

function documentMount(): string {
    if (typeof document === 'undefined') return ''
    documentMountRead ??=
        document
            .querySelector(`meta[name="${MOUNT_META}"]`)
            ?.getAttribute('content') ?? ''
    return documentMountRead
}

// An address below the app's root, as the address it is served at.
export function mounted(address: string): string {
    const mount = MOUNT.current()
    return mount === '' ? address : `${mount}${address}`
}

// A served pathname, as the address below the app's root — or `undefined` where it is not under the
// mount at all.
export function unmounted(pathname: string): string | undefined {
    const mount = MOUNT.current()
    if (mount === '') return pathname
    if (pathname === mount) return '/'
    return pathname.startsWith(`${mount}/`)
        ? pathname.slice(mount.length)
        : undefined
}
