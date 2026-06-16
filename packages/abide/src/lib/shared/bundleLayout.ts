import { basename, dirname, join } from 'node:path'

/*
Where a bundle's files live relative to its binary directory (the dir holding the
launcher + server — `dirname(process.execPath)` at runtime). A macOS `.app` nests
binaries under `Contents/MacOS`, the webview lib under `Contents/Frameworks`, and
data under `Contents/Resources` — the only one `codesign` seals as a *resource*,
so the shipped `.env` survives signing. Every other platform keeps everything
flat beside the binaries. The single source the bundler writes against and the
boot readers resolve from, so build and runtime can't disagree. Pure: computes
paths, never touches disk.
*/
export function bundleLayout(binaryDir: string): {
    binDir: string
    libDir: string
    resourcesDir: string
    envPath: string
} {
    const isMacApp = basename(binaryDir) === 'MacOS' && basename(dirname(binaryDir)) === 'Contents'
    if (isMacApp) {
        const contents = dirname(binaryDir)
        const resourcesDir = join(contents, 'Resources')
        return {
            binDir: binaryDir,
            libDir: join(contents, 'Frameworks'),
            resourcesDir,
            envPath: join(resourcesDir, '.env'),
        }
    }
    return {
        binDir: binaryDir,
        libDir: binaryDir,
        resourcesDir: binaryDir,
        envPath: join(binaryDir, '.env'),
    }
}
