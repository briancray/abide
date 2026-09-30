import { dirname, relative as relativePath } from 'node:path' // bun exposes no path helpers of its own
import type { AbideFile } from './parseAbide.ts'
import { abideSpecifiers } from './splitImports.ts'

/**
 * The build's component graph: which files are invoked as components, and where each file's
 * `.abide` imports land in the output tree.
 *
 * 32.17 — off ONE reading of every file's imports: each `.abide` specifier is resolved once,
 * against the file that wrote it, and both answers the build needs are read off that resolution.
 *
 * `invoked` is every source path another file imports as a component (`emitClient`'s `selfFill`).
 * By PATH, not by file name: two `Row.abide` in two directories are two components, and only the
 * one somebody imports carries its own markup.
 *
 * `imports` is, per importing file, where each `.abide` specifier it wrote lands in the output
 * tree, relative and without an extension (`componentImports`). The output mirrors the source, so
 * the path between two sources IS the path between their modules — which is what turns a seam
 * specifier (`#ui/components/Row.abide`) into one that resolves inside the build rather than into
 * a source tree where the compiler wrote nothing.
 *
 * `resolve` is the app's: a build asks bun, and a harness that lays an app out by hand answers for
 * its own seams. A specifier it cannot resolve, or that lands outside `files`, is left as written.
 */
export function componentGraph(
    files: readonly { path: string; file: AbideFile }[],
    resolve: (specifier: string, from: string) => string | undefined,
): {
    invoked: Set<string>
    imports: Map<string, Map<string, string>>
} {
    const known = new Set<string>()
    for (const entry of files) known.add(entry.path)
    const invoked = new Set<string>()
    const imports = new Map<string, Map<string, string>>()
    for (const entry of files) {
        const from = dirname(entry.path)
        const landed = new Map<string, string>()
        for (const script of [...entry.file.modules, ...entry.file.scripts])
            for (const specifier of abideSpecifiers(script)) {
                if (landed.has(specifier)) continue
                const target = resolve(specifier, from)
                if (target === undefined || !known.has(target)) continue
                invoked.add(target)
                const path = relativePath(
                    from,
                    target.slice(0, -'.abide'.length),
                )
                landed.set(specifier, path.startsWith('.') ? path : `./${path}`)
            }
        imports.set(entry.path, landed)
    }
    return { invoked, imports }
}
