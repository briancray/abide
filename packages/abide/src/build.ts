import { clientBuildPlugins } from './clientBuildPlugins.ts'
import { abideLog } from './lib/shared/abideLog.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { generateDeclarations } from './lib/shared/generateDeclarations.ts'
import { markFrameworkSourcesIgnored } from './lib/shared/markFrameworkSourcesIgnored.ts'

const CLIENT_ENTRY = new URL('./clientEntry.ts', import.meta.url).pathname

/*
Builds the client-side bundle into `${cwd}/dist` (see `appDir` below for the
exact directory). Runs Bun.build with the abide-ui `.abide` loader, the
virtual-module resolver, and (optionally) Tailwind. When `compress`, each emitted file is also
written as a gzip-compressed `.gz` sibling (level 9 — paid once at build
time) so the server can stream the precompressed bytes directly to any client
that accepts gzip (effectively all), and decompress on the fly otherwise. Dev
skips compression (compressing on every rebuild dwarfs the bundle itself) — the
server falls back to serving the plain bytes when no `.gz` sibling exists.

A production build (`clean`) emits into a per-build staging dir, then swaps it
into the stable `_app` with two atomic renames. This keeps every build's writes
isolated to a unique path (so a stray concurrent build can never `rm` files Bun
is mid-flushing — the "writing sourcemap: No such file or directory" race) and
means a reader never sees a half-built or emptied `_app`. `clean` also clears
the whole dist up front so downstream writers — the bundle's connect screen, the
CLI manifest — start fresh.

Dev (`clean: false`) instead emits each generation into its OWN
`_app.gen-<id>` directory and never mutates it afterward. A dev worker serves
from exactly the generation it was spawned on (via `ABIDE_APP_DIR`), so a rebuild
gives the new worker a new dir while the retiring worker keeps reading its own —
there is no shared mutable `_app`, hence no swap gap and no stale-hash 500s while
a replaced worker drains (both bind the port via reusePort). The orchestrator
prunes a generation dir once its worker has exited.

Returns `{ appDir }` — the directory the bundle now lives in (`_app` for a
production build, the generation dir for dev) — on success, or `false` on
failure. Never throws: a thrown Bun.build / fs error is logged and treated as a
failed build, so the dev loop (and its last-good server) survives instead of
crashing and orphaning the child. By default a failure exits the process
(one-shot `abide build` / `compile`); the dev orchestrator passes
`exitOnFailure: false`.
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
} = {}): Promise<{ appDir: string } | false> {
    const distDir = `${cwd}/dist`
    // The suffix isolates concurrent/successive builds.
    const buildId = crypto.randomUUID().slice(0, 8)
    /* Production owns the stable `_app`; dev owns a fresh per-generation dir it never
       rewrites (see the header — this is what removes the shared-mutable-`_app` race). */
    const appDir = clean ? `${distDir}/_app` : `${distDir}/_app.gen-${buildId}`
    /* Production stages then atomically swaps into `_app`. Dev builds straight into its
       generation dir — nothing reads it until a worker is spawned pointing at it. */
    const stagingDir = clean ? `${distDir}/_app.staging-${buildId}` : appDir
    const previousDir = `${distDir}/_app.old-${buildId}`

    const fail = (): false => {
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

        if (!dev) {
            abideLog.info('building client bundle…')
        }

        /* generateDeclarations builds the rpc `ts.Program` ONCE per build (ADR-0025 D2's
           alias-aware method detection) and writes every src/.abide/*.d.ts editor artifact. Run it
           CONCURRENTLY with Bun.build so its program build hides under the bundle. The runtime
           worker (dev worker / `abide start`) builds NO program at boot — only lazily on the first
           rpc request for the wire codec — so all boot-time .d.ts generation is gone. It never
           throws (editor types are non-critical), so it can't fail the build. */
        const [result] = await Promise.all([
            Bun.build({
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
                plugins,
            }),
            generateDeclarations({ cwd }),
        ])

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
        Production swap: move any existing `_app` aside, then rename staging into
        place. The window where `_app` is absent is a single rename, so a reader
        never observes a partial bundle; nothrow on the first move since no `_app`
        exists on a fresh (just-cleaned) dist. Dev skips this entirely — its bundle
        was built straight into the generation dir, which no worker reads until the
        orchestrator spawns one on it.
        */
        if (clean) {
            await Bun.$`mv ${appDir} ${previousDir}`.quiet().nothrow()
            await Bun.$`mv ${stagingDir} ${appDir}`.quiet()
            await Bun.$`rm -rf ${previousDir}`.quiet().nothrow()
        }

        if (compress) {
            abideLog.info(
                `wrote ${result.outputs.length} files to ${appDir} (+${result.outputs.length} .gz, ${(compressedBytes / 1024).toFixed(1)} KiB total)`,
            )
            // Per-file paths are noise at startup; surface them only under DEBUG=abide:build.
            const buildLog = abideLog.channel('abide:build')
            result.outputs.forEach((output) => {
                buildLog(`  - ${output.path.replace(stagingDir, appDir)}`)
            })
        } else {
            abideLog.info(`wrote ${result.outputs.length} files to ${appDir}`)
        }
        return { appDir }
    } catch (error) {
        abideLog.error(error)
        await Bun.$`rm -rf ${stagingDir} ${previousDir}`.quiet().nothrow()
        return fail()
    }
}
