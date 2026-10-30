// 38.5 AND 38.28 — THE MANIFEST: the files the entry was written under, and each module a route
// loads in a browser to every chunk that module needs before it can run. Read off the bundler's
// own metafile rather than off the emitted code, so a chunk the bundler hoisted into a shared file
// is in the list because the bundler says it is imported, not because a pattern over its output
// happened to match.
//
// THE ENTRY'S NAME IS HERE BECAUSE A BUILD HASHES IT (38.5). `abide dev` names it by its source
// (38.16) and reads it off this all the same, so the tags the document carries come from one
// place in both lanes rather than from a constant in one and a lookup in the other.
//
// THE STATIC CLOSURE AND NOTHING ELSE. An `import-statement` edge is a chunk the module cannot
// run without; a `dynamic-import` edge is a destination somebody may never navigate to, and
// preloading it is the whole route table on every page.
//
// THE ENTRY IS LEFT OUT of every list, because the document already loads it by name (38.22) and
// a preload of the same address is a second request line for bytes already on their way.

import { resolve } from 'node:path' // bun exposes no path helpers of its own

import { CLIENT_ENTRY } from './CLIENT_BUILD.ts'
import { VIRTUAL_DIRECTORY } from './VIRTUAL_DIRECTORY.ts'

// The entry's key: the table it is served as, below the root.
const ENTRY_MODULE = `${VIRTUAL_DIRECTORY}/${CLIENT_ENTRY}.ts`

export type Manifest = {
    /** The entry's file name, or undefined where the bundle has none — a dev build that failed. */
    entry: string | undefined
    /**
     * The stylesheet the bundler collected under the entry, or undefined where none was imported.
     *
     * 38.23.
     */
    stylesheet: string | undefined
    /** A module's path below the root — a route's `.abide` — to the chunk file names it needs, its own first. */
    chunks: Record<string, string[]>
}

export const NO_MANIFEST: Manifest = {
    entry: undefined,
    stylesheet: undefined,
    chunks: {},
}

/**
 * The manifest read off a bundle's metafile: the entry, its stylesheet, and each module's chunks.
 *
 * `root` IS THE TREE THE ROUTE TABLE NAMES MODULES BELOW, as its real path: the metafile names a file
 * relative to the working directory with symlinks resolved, and a table the plugin served under its
 * namespace as the plugin spelled it (`abideModules`).
 */
export function manifestOf(
    metafile: Bun.BuildMetafile,
    root: string,
): Manifest {
    const manifest: Manifest = { ...NO_MANIFEST, chunks: {} }
    const imports = new Map<string, string[]>()
    const modules = new Map<string, string>()
    const prefix = `${root}/`
    for (const [output, described] of Object.entries(metafile.outputs)) {
        if (!isModule(output)) continue
        const statically: string[] = []
        for (const edge of described.imports)
            if (isModule(edge.path) && edge.kind === 'import-statement')
                statically.push(chunkName(edge.path))
        imports.set(chunkName(output), statically)

        if (described.entryPoint === undefined) continue
        const path = resolve(described.entryPoint.replace(/^[\w-]{2,}:/, ''))
        if (!path.startsWith(prefix)) continue
        const module = path.slice(prefix.length)
        modules.set(module, chunkName(output))
        if (module !== ENTRY_MODULE) continue
        manifest.entry = chunkName(output)
        // NOT IN bun-types, and in the metafile: the stylesheet an entry's CSS was collected into.
        const sheet = (described as { cssBundle?: string }).cssBundle
        manifest.stylesheet = sheet === undefined ? undefined : chunkName(sheet)
    }

    for (const [module, output] of modules) {
        // THE ENTRY IS WALKED AND NOT LISTED: what it imports statically is as unfetched as the
        // page's own chunk until the entry has arrived.
        const needed: string[] = []
        const seen = new Set<string>()
        const stack = [output]
        for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
            if (seen.has(next)) continue
            seen.add(next)
            if (next !== manifest.entry) needed.push(next)
            for (const imported of imports.get(next) ?? []) stack.push(imported)
        }
        manifest.chunks[module] = needed
    }
    return manifest
}

/** Every chunk the modules need, once each, in the order they were first asked for. */
export function chunksOf(modules: string[], manifest: Manifest): string[] {
    const chunks = new Set<string>()
    for (const module of modules)
        for (const chunk of manifest.chunks[module] ?? []) chunks.add(chunk)
    return [...chunks]
}

/**
 * Whether a bundler output is a script module rather than a stylesheet.
 *
 * A MODULE, NOT A STYLESHEET. The bundler reports the CSS it collected both as a static import of
 * the entry and as an output whose entry point IS the entry — so unfiltered it is fetched as a
 * script, and it takes the entry's own place in the manifest. 38.23 links it already.
 */
function isModule(output: string): boolean {
    return output.endsWith('.js')
}

function chunkName(output: string): string {
    return output.startsWith('./') ? output.slice(2) : output
}
