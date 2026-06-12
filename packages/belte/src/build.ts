import { clientBuildPlugins } from './clientBuildPlugins.ts'
import { belteLog } from './lib/shared/belteLog.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import type { SvelteConfig } from './lib/shared/types/SvelteConfig.ts'

const CLIENT_ENTRY = new URL('./clientEntry.ts', import.meta.url).pathname

/*
Builds the client-side bundle into `${cwd}/dist/_app`. Runs Bun.build with
the svelte-dedupe plugin, the svelte loader, the virtual-module resolver,
and (optionally) Tailwind. When `compress`, each emitted file is also
written as a zstd-compressed `.zst` sibling (level 22 — paid once at build
time) so the server can stream the precompressed bytes directly when the
client supports it, and decompress on the fly for older clients. Dev skips
compression (zstd-22 on every rebuild dwarfs the bundle itself) — the
server falls back to serving the plain bytes when no `.zst` sibling exists.

The bundle is emitted into a per-build staging dir, then swapped into
`_app` with two atomic renames. This keeps every build's writes isolated to
a unique path (so a stray concurrent build can never `rm` files Bun is
mid-flushing — the "writing sourcemap: No such file or directory" race) and
means a long-running dev server reading `_app` lazily off disk never sees a
half-built or emptied directory.

`clean` (one-shot builds) clears the whole dist up front so downstream
writers — the bundle's connect screen, the CLI manifest — start fresh; the
dev orchestrator passes `clean: false` to leave the live dist untouched and
only swap `_app` at the end.

Returns whether the build succeeded. Never throws: a thrown Bun.build / fs
error is logged and treated as a failed build, so the dev loop (and its
last-good server) survives instead of crashing and orphaning the child. By
default a failure exits the process (one-shot `belte build` / `compile`);
the dev orchestrator passes `exitOnFailure: false`.
*/
export async function build({
    cwd = process.cwd(),
    svelteConfig,
    minify = true,
    compress = true,
    clean = true,
    exitOnFailure = true,
}: {
    cwd?: string
    svelteConfig?: SvelteConfig
    minify?: boolean
    compress?: boolean
    clean?: boolean
    exitOnFailure?: boolean
} = {}): Promise<boolean> {
    const distDir = `${cwd}/dist`
    const outDir = `${distDir}/_app`
    // Per-build staging + holding dirs; the suffix isolates concurrent builds.
    const buildId = crypto.randomUUID().slice(0, 8)
    const stagingDir = `${distDir}/_app.staging-${buildId}`
    const previousDir = `${distDir}/_app.old-${buildId}`

    const fail = (): boolean => {
        if (exitOnFailure) {
            process.exit(1)
        }
        return false
    }

    try {
        // shell-rm/-mv are the impure boundary for the dist swap — Bun.$ is first-party.
        if (clean) {
            await Bun.$`rm -rf ${distDir}`.quiet()
        }

        const config = svelteConfig ?? (await loadSvelteConfig(cwd))
        const plugins = await clientBuildPlugins({
            cwd,
            svelteConfig: config,
            tailwindWarning: 'bun-plugin-tailwind not installed; building without Tailwind',
        })

        const result = await Bun.build({
            entrypoints: [CLIENT_ENTRY],
            outdir: stagingDir,
            target: 'browser',
            splitting: true,
            minify,
            sourcemap: 'linked',
            naming: {
                entry: 'client-[hash].[ext]',
                chunk: '[name]-[hash].[ext]',
                asset: '[name].[ext]',
            },
            plugins,
        })

        if (!result.success) {
            await Bun.$`rm -rf ${stagingDir}`.quiet().nothrow()
            if (exitOnFailure) {
                exitOnBuildFailure(result)
            }
            result.logs.forEach((entry) => {
                belteLog.error(entry)
            })
            return false
        }

        // Dev skips the zstd siblings (paths still point into stagingDir here).
        const compressedBytes = compress
            ? (
                  await Promise.all(
                      result.outputs.map(async (output) => {
                          const bytes = await Bun.file(output.path).bytes()
                          const compressed = await Bun.zstdCompress(bytes, { level: 22 })
                          await Bun.write(`${output.path}.zst`, compressed)
                          return compressed.byteLength
                      }),
                  )
              ).reduce((total, length) => total + length, 0)
            : 0

        /*
        Swap staging into _app with two renames: move any existing _app aside,
        then rename staging into place. The window where _app is absent is a
        single rename, so a reader (the running dev server) never observes a
        partial bundle. nothrow on the first move: no _app exists on the first
        build or after `clean`.
        */
        await Bun.$`mv ${outDir} ${previousDir}`.quiet().nothrow()
        await Bun.$`mv ${stagingDir} ${outDir}`.quiet()
        await Bun.$`rm -rf ${previousDir}`.quiet().nothrow()

        if (compress) {
            belteLog.info(
                `wrote ${result.outputs.length} files to ${outDir} (+${result.outputs.length} .zst, ${(compressedBytes / 1024).toFixed(1)} KiB total)`,
            )
            // Per-file paths are noise at startup; surface them only under DEBUG=belte:build.
            const buildLog = belteLog.channel('belte:build')
            result.outputs.forEach((output) => {
                buildLog(`  - ${output.path.replace(stagingDir, outDir)}`)
            })
        } else {
            belteLog.info(`wrote ${result.outputs.length} files to ${outDir}`)
        }
        return true
    } catch (error) {
        belteLog.error(error)
        await Bun.$`rm -rf ${stagingDir} ${previousDir}`.quiet().nothrow()
        return fail()
    }
}
