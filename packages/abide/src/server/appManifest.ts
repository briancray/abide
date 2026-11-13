// 45.15 — THE WEB APP MANIFEST, which makes the app one a phone can put on its home screen: where the
// browser keeps what the service worker saved for as long as the app stays installed, rather than
// clearing it after a spell unvisited.

import { APP_MANIFEST_ADDRESS } from '#shared/ADDRESSES.ts'
import { appName } from '#shared/log.ts'
import { MOUNT, mounted } from '#shared/mount.ts'
import { ICON_ADDRESSES } from '#shared/NATIVE_FILES.ts'

import { pngSize } from './pngSize.ts'

/**
 * The tags a document links the manifest for the icon at `iconPath` by, and the manifest itself, or
 * `undefined` where it is not a PNG.
 *
 * DECLARED AT ITS OWN SIZE, read off the PNG's header: nothing on a server draws it at another
 * (`abide bundle` has `sips`, and a Linux host does not).
 */
export async function appManifest(
    iconPath: string,
): Promise<{ tags: string; body: string } | undefined> {
    const size = pngSize(await Bun.file(iconPath).slice(0, 24).bytes())
    if (size === undefined) return undefined
    const icon = mounted(ICON_ADDRESSES.png)
    const scope = `${MOUNT.current()}/`
    const name = appName()
    return {
        tags: `<link rel="manifest" href="${mounted(APP_MANIFEST_ADDRESS)}"><link rel="apple-touch-icon" href="${icon}">`,
        body: JSON.stringify({
            name,
            short_name: name,
            start_url: scope,
            scope,
            display: 'standalone',
            icons: [
                {
                    src: icon,
                    sizes: `${size.width}x${size.height}`,
                    type: 'image/png',
                },
            ],
        }),
    }
}
