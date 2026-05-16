import type { CompileTarget } from '../types/CompileTarget.ts'

export function detectTarget(
    platform: NodeJS.Platform = process.platform,
    arch: NodeJS.Architecture = process.arch,
): CompileTarget {
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
