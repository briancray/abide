import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { dedupeSveltePlugin } from './dedupeSveltePlugin.ts'
import { exitOnBuildFailure } from './lib/shared/exitOnBuildFailure.ts'
import { isModuleNotFound } from './lib/shared/isModuleNotFound.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import type { SvelteConfig } from './lib/shared/types/SvelteConfig.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const CLIENT_ENTRY = new URL('./clientEntry.ts', import.meta.url).pathname

/*
Builds the client-side bundle into `${cwd}/dist/_app`. Clears the dist
directory first, then runs Bun.build with the svelte-dedupe plugin, the
svelte loader, the virtual-module resolver, and (optionally) Tailwind.
Each emitted file is also written as a zstd-compressed `.zst` sibling
(level 22 — paid once at build time) so the server can stream the
precompressed bytes directly when the client supports it, and decompress
on the fly for older clients. Exits the process on build failure with
the build logs printed.
*/
export async function build({
    cwd = process.cwd(),
    svelteConfig,
    minify = true,
}: {
    cwd?: string
    svelteConfig?: SvelteConfig
    minify?: boolean
} = {}): Promise<void> {
    const distDir = `${cwd}/dist`
    const outDir = `${distDir}/_app`

    // shell-rm is the impure boundary for "clear dist" — Bun.$ is first-party
    await Bun.$`rm -rf ${distDir}`.quiet()

    const config = svelteConfig ?? (await loadSvelteConfig(cwd))
    const plugins: BunPlugin[] = [
        dedupeSveltePlugin({ cwd, conditions: ['browser', 'default'] }),
        sveltePlugin({ generate: 'client', svelteConfig: config }),
        belteResolverPlugin({ cwd, target: 'client' }),
    ]
    try {
        const tailwind = (await import('bun-plugin-tailwind')).default
        plugins.push(tailwind)
    } catch (error) {
        /*
        Tailwind is an optional peer — a genuine "not installed" is fine and
        builds without it. But only swallow the module-resolution failure;
        any other error (a plugin that loaded and then threw on a real
        misconfig) must surface, or the build silently ships unstyled.
        */
        if (!isModuleNotFound(error)) {
            throw error
        }
        log.warn('bun-plugin-tailwind not installed; building without Tailwind')
    }

    const result = await Bun.build({
        entrypoints: [CLIENT_ENTRY],
        outdir: outDir,
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

    exitOnBuildFailure(result)

    const compressedByteLengths = await Promise.all(
        result.outputs.map(async (output) => {
            const bytes = await Bun.file(output.path).bytes()
            const compressed = await Bun.zstdCompress(bytes, { level: 22 })
            await Bun.write(`${output.path}.zst`, compressed)
            return compressed.byteLength
        }),
    )
    const compressedBytes = compressedByteLengths.reduce((total, length) => total + length, 0)

    log.success(
        `wrote ${result.outputs.length} files to ${outDir} (+${result.outputs.length} .zst, ${(compressedBytes / 1024).toFixed(1)} KiB total)`,
    )
    result.outputs.forEach((output) => {
        log.detail(`  - ${output.path}`)
    })
}
