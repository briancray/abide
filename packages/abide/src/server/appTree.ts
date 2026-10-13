// 23.14 — WHERE AN APP'S ADDRESSES ARE, read off the tree in one walk. Every directory below the root
// is a segment of an address, and a `page.abide`, `layout.abide` or `error.abide` in it answers there;
// a `server` or `public` directory is never one (23.15) — the first fences a graph and the second
// holds files answered as authored, at the path of the directories above it. So an app is organized
// by subject (`media/[id]/page.abide`, `media/server`) and the addresses follow.
//
// ONE WALK for the sources and the public files `abide build` copies and `abide dev` answers, and
// the refusals (23.16, 23.17, 23.18) — and ONE SKIP RULE, `skipped`, for every walk of the tree,
// beside `placeOf`, which answers the same question of one path.
//
// A WALK RATHER THAN A GLOB: a glob descends `node_modules` and the build output before a filter
// can drop them.

import { type Dirent, readdirSync } from 'node:fs' // bun has no directory listing of its own
import { ABIDE_ADDRESS } from '#shared/ADDRESSES.ts'
import {
    PUBLIC_DIRECTORY,
    RESERVED_DIRECTORIES,
} from '#shared/RESERVED_DIRECTORIES.ts'
import { fileKind, routeOf, skipped } from '#shared/routePattern.ts'

/** What one walk of the app finds, every path relative to the root. */
export type AppFiles = {
    /** Every `.abide`, in path order. */
    abide: string[]
    /** Every file under a `public` directory, to the address it is answered at below the mount. */
    published: Map<string, string>
}

/** Told of each thing the tree refuses, at the path relative to the root. */
type Refuse = (path: string, message: string) => void

const THROW: Refuse = (_path, message) => {
    throw new Error(message)
}

/**
 * The app's `.abide` sources and public files, refusing a tree 23.16, 23.17 or 23.18 forbids.
 *
 * `refuse` throws by default, which is the build's answer; `abide check` collects instead (38.33),
 * and the checker's route table ignores them, since a refused tree is the build's to report.
 *
 * A missing root is an app with nothing in it, not a fault.
 */
export function appFiles(root: string, refuse: Refuse = THROW): AppFiles {
    const files: AppFiles = { abide: [], published: new Map() }
    walk(root, '', undefined, files, refuse)
    files.abide.sort()
    return files
}

// `reserved` is the nearest reserved directory above `relative` — its path and its name — or
// `undefined` where none is.
function walk(
    directory: string,
    relative: string,
    reserved: { path: string; name: string } | undefined,
    files: AppFiles,
    refuse: Refuse,
): void {
    let entries: Dirent[]
    try {
        entries = readdirSync(directory, { withFileTypes: true })
    } catch (thrown) {
        if ((thrown as { code?: unknown }).code === 'ENOENT') return
        throw thrown
    }
    for (const entry of entries) {
        if (skipped(entry.name)) continue
        const path = `${relative}${entry.name}`
        if (entry.isDirectory()) {
            let within = reserved
            if (RESERVED_DIRECTORIES.has(entry.name)) {
                if (reserved !== undefined)
                    refuse(
                        path,
                        `abide: ${path} is a ${entry.name} directory under the ${reserved.name} directory ${reserved.path}. RULEBOOK 23.16.`,
                    )
                within = { path, name: entry.name }
            }
            walk(
                `${directory}/${entry.name}`,
                `${path}/`,
                within,
                files,
                refuse,
            )
            continue
        }
        if (path.endsWith('.abide')) files.abide.push(path)
        if (reserved === undefined) {
            // 23.17 — anything that could answer here would answer in abide's own namespace.
            if (path.endsWith('.abide'))
                refuseFrameworkRoute(routeOf(path), path, refuse)
        } else if (fileKind(entry.name) !== 'component')
            refuse(
                path,
                `abide: ${path} is a ${entry.name} under the ${reserved.name} directory ${reserved.path}, where nothing has an address. RULEBOOK 23.18.`,
            )
        else if (reserved.name === PUBLIC_DIRECTORY)
            files.published.set(path, publicAddress(path, reserved.path))
    }
}

/** Refuses `source` where `route` lies in the framework's own namespace. 23.17. */
export function refuseFrameworkRoute(
    route: string,
    source: string,
    refuse: Refuse = THROW,
): void {
    if (route === ABIDE_ADDRESS || route.startsWith(`${ABIDE_ADDRESS}/`))
        refuse(
            source,
            `abide: ${source} answers at ${route}, which is under ${ABIDE_ADDRESS}, where abide's own addresses are. RULEBOOK 23.17.`,
        )
}

// 36.11 — the directories above `public`, then the file's own path below it.
function publicAddress(path: string, directory: string): string {
    const above = directory.slice(0, -PUBLIC_DIRECTORY.length)
    return `/${above}${path.slice(directory.length + 1)}`
}

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
 * Every `.abide` under `root`, relative to it, in path order — the app's own, and none a
 * dependency ships.
 *
 * Refuses nothing: the language server lists them on every check, and a tree 23.16 forbids is the
 * build's to refuse (`appFiles`).
 */
export function abideUnder(root: string): string[] {
    const found: string[] = []
    for (const path of abideFilesUnder(root, '')) found.push(path)
    return found.sort()
}

/**
 * Whether a `.abide` lies anywhere under `root` — stopping at the first.
 *
 * 38.26's question, asked of a root before anything is built from it, so asking it of a large tree
 * is as cheap as the tree allows.
 */
export function holdsAbide(root: string): boolean {
    return !abideFilesUnder(root, '').next().done
}

function* abideFilesUnder(
    directory: string,
    relative: string,
): Generator<string> {
    let entries: Dirent[]
    try {
        entries = readdirSync(directory, { withFileTypes: true })
    } catch {
        return
    }
    for (const entry of entries) {
        if (skipped(entry.name)) continue
        const path = `${relative}${entry.name}`
        if (entry.isDirectory())
            yield* abideFilesUnder(`${directory}/${entry.name}`, `${path}/`)
        else if (path.endsWith('.abide')) yield path
    }
}
