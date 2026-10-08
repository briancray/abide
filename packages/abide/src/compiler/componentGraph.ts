import { dirname, posix, relative as relativePath } from 'node:path' // bun exposes no path helpers of its own
import { type FileKind, fileKind, routeOf } from '#shared/routePattern.ts'
import type { AbideFile } from './parseAbide.ts'
import { abideImports, relativeSpecifiers } from './splitImports.ts'

type Resolve = (specifier: string, from: string) => string | undefined

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
 * tree, relative and without an extension (`splitImports`). The output mirrors the source, so
 * the path between two sources IS the path between their modules — which is what turns a seam
 * specifier (`#ui/components/Row.abide`) into one that resolves inside the build rather than into
 * a source tree where the compiler wrote nothing.
 *
 * `resolve` is the app's: a build asks bun, and a harness that lays an app out by hand answers for
 * its own seams. A specifier it cannot resolve, or that lands outside `files`, is left as written.
 */
export function componentGraph(
    files: readonly { path: string; file: AbideFile }[],
    resolve: Resolve,
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
        for (const [specifier, target] of abideImportsOf(
            entry.path,
            entry.file,
            resolve,
        )) {
            if (!known.has(target)) continue
            invoked.add(target)
            const path = relativePath(from, target.slice(0, -'.abide'.length))
            landed.set(specifier, path.startsWith('.') ? path : `./${path}`)
        }
        imports.set(entry.path, landed)
    }
    return { invoked, imports }
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
    for (const script of [...file.modules, ...file.scripts])
        for (const { specifier } of abideImports(script)) {
            if (resolved.has(specifier)) continue
            const target = resolve(specifier, from)
            if (target !== undefined) resolved.set(specifier, target)
        }
    return resolved
}

/** One source in the app graph: where it is below the root, what it is, and its address. */
export type AppNode<Source> = Source & {
    relative: string
    kind: FileKind
    /** 23.3 — the address of a page or an error page, and `undefined` for anything else. */
    route: string | undefined
}

/**
 * The app as one graph, built once per build or check: every source with its kind and address,
 * which files are invoked as components, and where each file's every import lands.
 *
 * `imports` is `componentGraph`'s with the relative specifiers landed beside the `.abide` ones —
 * 34.14, A RELATIVE IMPORT RESOLVES FROM THE FILE THAT WROTE IT. The module that file compiles to
 * is in the output tree, which holds compiled `.abide` files and nothing else, so a stylesheet or
 * a `.ts` beside the source is reached by the path from the module back to it.
 *
 * `output` is where the modules are written, relative to `root`.
 */
export function appGraph<Source extends { path: string; file: AbideFile }>(
    root: string,
    sources: readonly Source[],
    output: string,
    resolve: Resolve,
): {
    nodes: AppNode<Source>[]
    invoked: Set<string>
    imports: Map<string, Map<string, string>>
} {
    const nodes: AppNode<Source>[] = []
    for (const source of sources) {
        const relative = source.path.slice(root.length + 1)
        const kind = fileKind(relative)
        nodes.push({
            ...source,
            relative,
            kind,
            route:
                kind === 'page' || kind === 'error'
                    ? routeOf(relative)
                    : undefined,
        })
    }
    const { invoked, imports } = componentGraph(sources, resolve)
    for (const node of nodes) {
        const landed = imports.get(node.path) as Map<string, string>
        const written = dirname(node.path)
        const emitted = posix.join(root, output, dirname(node.relative))
        for (const script of [...node.file.modules, ...node.file.scripts])
            for (const specifier of relativeSpecifiers(script)) {
                const path = posix.relative(
                    emitted,
                    posix.join(written, specifier),
                )
                landed.set(specifier, path.startsWith('.') ? path : `./${path}`)
            }
    }
    return { nodes, invoked, imports }
}
