import { existsSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { loadSvelteConfig } from './lib/shared/loadSvelteConfig.ts'
import { log } from './lib/shared/log.ts'
import type { SvelteConfig } from './lib/types/SvelteConfig.ts'
import { sveltePlugin } from './sveltePlugin.ts'

type ExportEntry = string | { [condition: string]: ExportEntry }

/*
Walks a package.json `exports` entry, returning the first leaf string that
matches the supplied condition list in order. Returns undefined when no
branch resolves.
*/
function pickExport(entry: ExportEntry, conditions: string[]): string | undefined {
    if (typeof entry === 'string') {
        return entry
    }
    for (const condition of conditions) {
        if (entry[condition]) {
            const resolved = pickExport(entry[condition], conditions)
            if (resolved) {
                return resolved
            }
        }
    }
    return undefined
}

/*
Forces every `import 'svelte/...'` (from belte's own source, the consumer's
source, or any transitive dep) to resolve against the consumer app's svelte
install, picking the export condition that matches the build target.
Without this, belte's symlinked source can pick up a second svelte from its
install location, ship both runtimes, and break hydration.
*/
function dedupeSveltePlugin({ cwd, conditions }: { cwd: string; conditions: string[] }): BunPlugin {
    const consumerSvelte = `${cwd}/node_modules/svelte`
    return {
        name: 'belte-dedupe-svelte',
        async setup(build) {
            if (!existsSync(`${consumerSvelte}/package.json`)) {
                return
            }
            const consumerPackage = (await Bun.file(`${consumerSvelte}/package.json`).json()) as {
                exports: Record<string, ExportEntry>
            }
            build.onResolve({ filter: /^svelte(\/.*)?$/ }, (args) => {
                const subpath =
                    args.path === 'svelte' ? '.' : `.${args.path.slice('svelte'.length)}`
                const entry = consumerPackage.exports[subpath]
                if (!entry) {
                    return undefined
                }
                const resolvedFile = pickExport(entry, conditions)
                if (!resolvedFile) {
                    return undefined
                }
                return { path: `${consumerSvelte}/${resolvedFile.replace(/^\.\//, '')}` }
            })
        },
    }
}

const CLIENT_ENTRY = new URL('./clientEntry.ts', import.meta.url).pathname

/*
Builds the client-side bundle into `${cwd}/dist/_app`. Clears the dist
directory first, then runs Bun.build with the svelte-dedupe plugin, the
svelte loader, the virtual-module resolver, and (optionally) Tailwind.
Each emitted file is also written as a gzipped `.gz` sibling so the server
can stream the precompressed bytes directly. Exits the process on build
failure with the build logs printed.
*/
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
        dedupeSveltePlugin({ cwd, conditions: ['browser', 'default'] }),
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

    const gzippedByteLengths = await Promise.all(
        result.outputs.map(async (output) => {
            const bytes = await Bun.file(output.path).bytes()
            const gzipped = Bun.gzipSync(bytes)
            await Bun.write(`${output.path}.gz`, gzipped)
            return gzipped.byteLength
        }),
    )
    const gzippedBytes = gzippedByteLengths.reduce((total, length) => total + length, 0)

    log.success(
        `wrote ${result.outputs.length} files to ${outDir} (+${result.outputs.length} .gz, ${(gzippedBytes / 1024).toFixed(1)} KiB total)`,
    )
    for (const output of result.outputs) {
        log.detail(`  - ${output.path}`)
    }
}
