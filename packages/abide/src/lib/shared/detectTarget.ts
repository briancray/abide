import type { CompileTarget } from './types/CompileTarget.ts'

/*
Picks the Bun compile target matching the current host. Throws if the
platform/arch pair isn't one of the supported Bun standalone targets — the
CLI's `--target` flag is the escape hatch for cross-compilation.
*/
const HOST_TO_TARGET: Record<string, CompileTarget> = {
    'darwin-arm64': 'bun-darwin-arm64',
    'darwin-x64': 'bun-darwin-x64',
    'linux-arm64': 'bun-linux-arm64',
    'linux-x64': 'bun-linux-x64',
    'win32-x64': 'bun-windows-x64',
}

export function detectTarget(
    platform: NodeJS.Platform = process.platform,
    arch: NodeJS.Architecture = process.arch,
): CompileTarget {
    const target = HOST_TO_TARGET[`${platform}-${arch}`]
    if (!target) {
        throw new Error(
            `[abide] unsupported host platform ${platform}/${arch}. Pass --target=<bun-...> explicitly.`,
        )
    }
    return target
}
