import { clientBuildPlugins } from './clientBuildPlugins.ts'
import { abideLog } from './lib/shared/abideLog.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { markFrameworkSourcesIgnored } from './lib/shared/markFrameworkSourcesIgnored.ts'

const CLIENT_ENTRY = new URL('./clientEntry.ts', import.meta.url).pathname

/*
Builds the client-side bundle into `${cwd}/dist/_app`. Runs Bun.build with
the abide-ui `.abide` loader, the virtual-module resolver, and (optionally)
Tailwind. When `compress`, each emitted file is also
written as a gzip-compressed `.gz` sibling (level 9 — paid once at build
time) so the server can stream the precompressed bytes directly to any client
that accepts gzip (effectively all), and decompress on the fly otherwise. Dev
skips compression (compressing on every rebuild dwarfs the bundle itself) — the
server falls back to serving the plain bytes when no `.gz` sibling exists.

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
default a failure exits the process (one-shot `abide build` / `compile`);
the dev orchestrator passes `exitOnFailure: false`.
*/
// @documentation building
export async function build({
    cwd = process.cwd(),
    minify = true,
    compress = true,
    clean = true,
    exitOnFailure = true,
    dev = false,
}: {
    cwd?: string
    minify?: boolean
    compress?: boolean
    clean?: boolean
    exitOnFailure?: boolean
    dev?: boolean
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

        const plugins = await clientBuildPlugins({
            cwd,
            tailwindWarning: 'bun-plugin-tailwind not installed; building without Tailwind',
        })

        const result = await Bun.build({
            entrypoints: [CLIENT_ENTRY],
            outdir: stagingDir,
            target: 'browser',
            splitting: true,
            minify,
            sourcemap: 'linked',
            /* The abideResolverPlugin's onEnd reachability guard (ADR-0022 D3) reads this to
               classify surviving modules post-DCE and reject any server-only code that leaked. */
            metafile: true,
            naming: {
                entry: 'client-[hash].[ext]',
                chunk: '[name]-[hash].[ext]',
                asset: '[name].[ext]',
            },
            /* Build-time flag the client reads to fold away dev-only machinery: production
               (`dev: false`) defines it false so the hot-reload subtree — mountChild's
               record path, hotReplace, captureModelDoc — dead-code-eliminates instead of
               shipping behind a runtime flag the minifier can't prove. Dev defines it true
               to keep HMR. Under `bun test` no define applies; the source falls back to true
               so `hotReloadEnabled` alone governs (see startClient/mountChild). */
            define: { __ABIDE_DEV__: dev ? 'true' : 'false' },
            plugins,
        })

        if (!result.success) {
            await Bun.$`rm -rf ${stagingDir}`.quiet().nothrow()
            if (exitOnFailure) {
                exitOnBuildFailure(result)
            }
            result.logs.forEach((entry) => {
                abideLog.error(entry)
            })
            return false
        }

        /* Ignore-list abide's own framework sources in every emitted map, so a debugger
           collapses the mount-stack wall (scope/mountRange/runNode/…) and a stack trace
           shows only authored `.abide`/`.ts` frames. Runs before the gzip step so the
           `.gz` siblings compress the updated maps. */
        await Promise.all(
            result.outputs
                .filter((output) => output.kind === 'sourcemap')
                .map(async (output) => {
                    const map = await Bun.file(output.path).json()
                    await Bun.write(output.path, JSON.stringify(markFrameworkSourcesIgnored(map)))
                }),
        )

        // Dev skips the gzip siblings (paths still point into stagingDir here).
        const compressedBytes = compress
            ? (
                  await Promise.all(
                      result.outputs.map(async (output) => {
                          const bytes = await Bun.file(output.path).bytes()
                          const compressed = Bun.gzipSync(bytes, { level: 9 })
                          await Bun.write(`${output.path}.gz`, compressed)
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
            abideLog.info(
                `wrote ${result.outputs.length} files to ${outDir} (+${result.outputs.length} .gz, ${(compressedBytes / 1024).toFixed(1)} KiB total)`,
            )
            // Per-file paths are noise at startup; surface them only under DEBUG=abide:build.
            const buildLog = abideLog.channel('abide:build')
            result.outputs.forEach((output) => {
                buildLog(`  - ${output.path.replace(stagingDir, outDir)}`)
            })
        } else {
            abideLog.info(`wrote ${result.outputs.length} files to ${outDir}`)
        }
        return true
    } catch (error) {
        abideLog.error(error)
        await Bun.$`rm -rf ${stagingDir} ${previousDir}`.quiet().nothrow()
        return fail()
    }
}
