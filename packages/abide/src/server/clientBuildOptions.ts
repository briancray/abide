import { CLIENT_ADDRESS } from '#shared/ADDRESSES.ts'
import { tablePath } from './abideModules.ts'
import { CLIENT_ENTRY } from './CLIENT_BUILD.ts'

/**
 * The `Bun.build` options for the client bundle both lanes build.
 *
 * `abide build` builds it to disk and `abide dev` in memory. 30.8 says dev resolves an address the
 * way the built app does, so what decides resolution is written once here and each lane adds only
 * where the output goes and how it is named.
 */
export function clientBuildOptions(
    root: string,
    plugins: Bun.BunPlugin[],
    publicAddresses: string[],
) {
    return {
        // The entry is a table the plugin serves (`abideModules`), below the root.
        entrypoints: [tablePath(root, `${CLIENT_ENTRY}.ts`)] as string[],
        // The app's own root, because `Bun.build` opens the entry's directory otherwise, and the
        // tables' is not on disk to open.
        root,
        // 16.28, 16.29 — a `<script server>` is its stand-ins here, and a `server/` module refuses.
        plugins,
        target: 'browser',
        format: 'esm',
        splitting: true,
        metafile: true,
        // 36.15 — a stylesheet's `url('/fonts/…')` is the public file's address, not a path here,
        // and `Bun.build` reads a leading `/` as a path on this disk and fails on it not being
        // there. The list is the files that exist rather than every `/…`: a URL naming nothing the
        // app serves is still worth a build error.
        external: publicAddresses,
    } as const
}

// From the bundle's own directory up to the app's root: `../../` below `/__abide/client`.
const UP_TO_ROOT = '../'.repeat(CLIENT_ADDRESS.split('/').length - 1)

/**
 * A built stylesheet with every root-absolute `url()` written relative to the bundle's directory.
 *
 * 16.10, 36.15 — THE SAME MECHANISM AS THE HANDLER WRAPPERS: the address is written relative to
 * where the bundle is served and the browser resolves it against the sheet, so one build serves
 * at the root and below a mount. What survives the build as `url(/…)` is a public file's address
 * (the `external` list above), and the browser would resolve it against the origin. `//` is
 * another host's.
 */
export function stylesheetUnderMount(css: string): string {
    return css.replace(
        /url\((["']?)\/(?!\/)/g,
        (_whole, quote: string) => `url(${quote}${UP_TO_ROOT}`,
    )
}
