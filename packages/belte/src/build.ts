import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import type { SvelteConfig } from './lib/types/SvelteConfig.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const CLIENT_ENTRY = new URL('./clientEntry.ts', import.meta.url).pathname

export async function build({
    cwd = process.cwd(),
    svelteConfig,
}: {
    cwd?: string
    svelteConfig?: SvelteConfig
} = {}): Promise<void> {
    const distDir = `${cwd}/dist`
    const outDir = `${distDir}/_app`

    // shell-rm is the impure boundary for "clear dist" — Bun.$ is first-party
    await Bun.$`rm -rf ${distDir}`.quiet()

    const config = svelteConfig ?? (await loadSvelteConfig(cwd))
    const plugins: BunPlugin[] = [
        sveltePlugin({ generate: 'client', svelteConfig: config }),
        belteResolverPlugin({ cwd }),
    ]
    try {
        const tailwind = (await import('bun-plugin-tailwind')).default
        plugins.push(tailwind)
    } catch {
        log.warn('bun-plugin-tailwind not installed; building without Tailwind')
    }

    const result = await Bun.build({
        entrypoints: [CLIENT_ENTRY],
        outdir: outDir,
        target: 'browser',
        splitting: true,
        minify: true,
        sourcemap: 'linked',
        naming: {
            entry: 'client.[ext]',
            chunk: '[name]-[hash].[ext]',
            asset: '[name].[ext]',
        },
        plugins,
    })

    if (!result.success) {
        for (const entry of result.logs) {
            log.error(entry)
        }
        process.exit(1)
    }

    const gzipResults = await Promise.all(
        result.outputs.map(async (out) => {
            const bytes = await Bun.file(out.path).bytes()
            const gz = Bun.gzipSync(bytes)
            await Bun.write(`${out.path}.gz`, gz)
            return gz.byteLength
        }),
    )
    const gzippedBytes = gzipResults.reduce((a, b) => a + b, 0)

    log.success(
        `wrote ${result.outputs.length} files to ${outDir} (+${result.outputs.length} .gz, ${(gzippedBytes / 1024).toFixed(1)} KiB total)`,
    )
    for (const out of result.outputs) {
        log.detail(`  - ${out.path}`)
    }
}
