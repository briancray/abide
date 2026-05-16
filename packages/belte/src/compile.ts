import type { BunPlugin } from 'bun'
import { belteResolverPlugin } from './belteResolverPlugin.ts'
import { build } from './build.ts'
import { log } from './log.ts'
import { sveltePlugin } from './sveltePlugin.ts'

const SERVER_ENTRY = new URL('./serverEntry.ts', import.meta.url).pathname

export type CompileTarget =
    | 'bun-darwin-arm64'
    | 'bun-darwin-x64'
    | 'bun-linux-arm64'
    | 'bun-linux-x64'
    | 'bun-windows-x64'

export function detectTarget(): CompileTarget {
    const platform = process.platform
    const arch = process.arch
    if (platform === 'darwin' && arch === 'arm64') {
        return 'bun-darwin-arm64'
    }
    if (platform === 'darwin' && arch === 'x64') {
        return 'bun-darwin-x64'
    }
    if (platform === 'linux' && arch === 'arm64') {
        return 'bun-linux-arm64'
    }
    if (platform === 'linux' && arch === 'x64') {
        return 'bun-linux-x64'
    }
    if (platform === 'win32' && arch === 'x64') {
        return 'bun-windows-x64'
    }
    throw new Error(
        `[belte] unsupported host platform ${platform}/${arch}. Pass --target=<bun-...> explicitly.`,
    )
}

export function normalizeTarget(input: string): CompileTarget {
    const normalized = input.startsWith('bun-') ? input : `bun-${input}`
    return normalized as CompileTarget
}

export async function compile({
    cwd = process.cwd(),
    target = detectTarget(),
    outfile,
}: {
    cwd?: string
    target?: CompileTarget
    outfile?: string
} = {}): Promise<string> {
    await build({ cwd })

    const out = outfile ?? `${cwd}/dist/server${target.includes('windows') ? '.exe' : ''}`

    const plugins: BunPlugin[] = [
        sveltePlugin({ generate: 'server' }),
        belteResolverPlugin({ cwd, embedAssets: true }),
    ]

    const result = await Bun.build({
        entrypoints: [SERVER_ENTRY],
        target: 'bun',
        compile: { target, outfile: out },
        plugins,
    })

    if (!result.success) {
        for (const entry of result.logs) {
            log.error(entry)
        }
        process.exit(1)
    }

    log.success(`compiled standalone binary: ${out} (target: ${target})`)
    return out
}
