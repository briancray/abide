import { dirname } from 'node:path' // bun exposes no path helpers of its own

import { type AbideFile, scriptBodies } from './parseAbide.ts'
import { abideImports } from './splitImports.ts'

type Resolve = (specifier: string, from: string) => string | undefined

/**
 * Which files are invoked as components: every source path another file imports.
 *
 * 32.17 — off ONE reading of every file's imports, each `.abide` specifier resolved once against
 * the file that wrote it. By PATH, not by file name: two `Row.abide` in two directories are two
 * components, and only the one somebody imports carries its own markup (`emitClient`'s `selfFill`).
 *
 * `resolve` is the app's: a build asks bun, and a harness that lays an app out by hand answers for
 * its own seams. A specifier it cannot resolve, or that lands outside `files`, invokes nothing.
 */
export function componentGraph(
    files: readonly { path: string; file: AbideFile }[],
    resolve: Resolve,
): { invoked: Set<string> } {
    const known = new Set<string>()
    for (const entry of files) known.add(entry.path)
    const invoked = new Set<string>()
    for (const entry of files)
        for (const target of abideImportsOf(
            entry.path,
            entry.file,
            resolve,
        ).values())
            if (known.has(target)) invoked.add(target)
    return { invoked }
}

/**
 * Each `.abide` the file at `path` imports, by the specifier it wrote, resolved from the file —
 * statically or through an `import('…')` naming it as a literal, which is the same edge (34.15).
 *
 * A specifier `resolve` cannot answer is not an edge. `checkSource` reads one file's components
 * through this and the build reads every file's (`componentGraph`), so the two cannot disagree
 * about what a page imports.
 */
export function abideImportsOf(
    path: string,
    file: AbideFile,
    resolve: Resolve,
): Map<string, string> {
    const from = dirname(path)
    const resolved = new Map<string, string>()
    for (const script of scriptBodies(file))
        for (const { specifier } of abideImports(script)) {
            if (resolved.has(specifier)) continue
            const target = resolve(specifier, from)
            if (target !== undefined) resolved.set(specifier, target)
        }
    return resolved
}
