import { dirname, relative as relativeTo } from 'node:path' // bun exposes no path helpers of its own
import {
    type FileKind,
    fileKind,
    placeOf,
    routeOf,
} from '#shared/routePattern.ts'
import { type AbideFile, scriptBodies } from './parseAbide.ts'
import { abideImports, attributedImports } from './splitImports.ts'

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

/** One source in the app graph: where it is below the root, what it is, and its address. */
export type AppNode<Source> = Source & {
    relative: string
    /** 23.19 — the path it answers by: its own below the root, or the one its mount gives it. */
    position: string
    kind: FileKind
    /** 23.3 — the address of a page or an error page, and `undefined` for anything else. */
    route: string | undefined
}

/**
 * The app as one graph, built once per build or check: every source with its kind and address,
 * and which files are invoked as components.
 */
export function appGraph<
    Source extends {
        path: string
        file: AbideFile
        position?: string | undefined
    },
>(
    root: string,
    sources: readonly Source[],
    resolve: Resolve,
): { nodes: AppNode<Source>[]; invoked: Set<string> } {
    const nodes: AppNode<Source>[] = []
    for (const source of sources) {
        // Below the root for the app's own files, and above it — `../node_modules/…` — for a
        // dependency's (34.28).
        const relative = relativeTo(root, source.path)
        const position = source.position ?? relative
        // 34.21 — a server block of the app's own under a `server` or `public` directory has no
        // address: refused here, before anything reads one off it. A dependency's has none of its own
        // (34.31); the app mounts what it declares where the app re-exports it.
        const place = placeOf(position)
        if (
            source.file.servers.length > 0 &&
            (place === 'server' || place === 'public')
        )
            throw new Error(
                `abide: ${relative} has a <script server>, and it is under a ${place} directory, where nothing has an address. Move the file out of it, or the code into a module under a server directory. RULEBOOK 34.21.`,
            )
        // 34.25 — a file imported as text is found at build, not when its module first loads.
        for (const script of scriptBodies(source.file))
            for (const { specifier } of attributedImports(script, 'text'))
                if (resolve(specifier, dirname(source.path)) === undefined)
                    throw new Error(
                        `abide: ${relative} imports ${specifier} as text, and there is no such file. RULEBOOK 34.25.`,
                    )
        const kind = fileKind(position)
        nodes.push({
            ...source,
            relative,
            position,
            kind,
            route:
                kind === 'page' || kind === 'error'
                    ? routeOf(position)
                    : undefined,
        })
    }
    return { nodes, invoked: componentGraph(sources, resolve).invoked }
}
