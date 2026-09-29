import { CLIENT_ENTRY } from './CLIENT_BUILD.ts'

/**
 * The `Bun.build` options for the client bundle both lanes build.
 *
 * `abide build` builds it to disk and `abide dev` in memory. 30.8 says dev resolves an address the
 * way the built app does, so what decides resolution is written once here and each lane adds only
 * where the output goes and how it is named.
 */
export function clientBuildOptions(
    entryDirectory: string,
    plugins: Bun.BunPlugin[],
    publicAddresses: string[],
) {
    return {
        entrypoints: [`${entryDirectory}/${CLIENT_ENTRY}.ts`] as string[],
        // 16.29, 16.30 — a handler module is its wrapper here, and the rest of `server/` refuses.
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
