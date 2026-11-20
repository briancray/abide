// 38.26, 38.19 — what the server asks of an app's tree without walking it for the build: whether an
// app lies under a root, and where `abide dev` answers its public files from. The walk itself is the
// compiler's (`#compiler/appFiles.ts`), and both skip what `placement.ts`'s `skipped` skips.

import { type Dirent, readdirSync } from 'node:fs' // bun has no directory listing of its own

import { isHandlerFile, placeOf, skipped } from './placement.ts'

/**
 * The public files as the server reads them: each address, without its leading `/`, to the file.
 *
 * 38.19 — out of the source tree, where `abide dev` answers them.
 */
export function publishedUnder(
    root: string,
    published: Map<string, string>,
): Map<string, string> {
    const paths = new Map<string, string>()
    for (const [source, address] of published)
        paths.set(address.slice(1), `${root}/${source}`)
    return paths
}

/**
 * Whether an app lies under `root`: a `.abide` anywhere or a handler file, stopping at the first.
 *
 * 38.26's question, asked of a root before anything is built from it, so asking it of a large tree
 * is as cheap as the tree allows.
 */
export function holdsApp(root: string): boolean {
    return holdsAppUnder(root, '')
}

// Whether `directory` holds a `.abide`, or a handler file whose place is an address.
function holdsAppUnder(directory: string, relative: string): boolean {
    let entries: Dirent[]
    try {
        entries = readdirSync(directory, { withFileTypes: true })
    } catch {
        return false
    }
    for (const entry of entries) {
        if (skipped(entry.name)) continue
        const path = `${relative}${entry.name}`
        if (entry.isDirectory()) {
            if (holdsAppUnder(`${directory}/${entry.name}`, `${path}/`))
                return true
        } else if (
            path.endsWith('.abide') ||
            (isHandlerFile(path) && placeOf(path) === 'address')
        )
            return true
    }
    return false
}
