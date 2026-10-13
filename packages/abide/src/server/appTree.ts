// 23.14 — WHERE AN APP'S ADDRESSES ARE, read off the tree in one walk. A file directly in a directory
// below the root is an address — a page, a layout, an error page or a handler file — and nothing
// else is there (23.22); a fence is never one (23.15): `server` fences a graph, `public` holds files
// answered as authored at the path of the directories above it, and `lib` and `tests` hold the rest.
// So listing a directory lists its routes.
//
// ONE WALK for the sources, the handler files, the server and lib modules, and the public files
// `abide build` copies and `abide dev` answers, and the refusals (23.16, 23.17, 23.18, 23.22) — and
// ONE SKIP RULE, `skipped`, for every walk of the tree, beside `placeOf`, which answers the same
// question of one path.
//
// A WALK RATHER THAN A GLOB: a glob descends `node_modules` and the build output before a filter
// can drop them.

import { type Dirent, existsSync, readdirSync } from 'node:fs' // bun has no directory listing or sync existence check of its own
import { ABIDE_ADDRESS } from '#shared/ADDRESSES.ts'
import {
    LIB_DIRECTORY,
    PUBLIC_DIRECTORY,
    RESERVED_DIRECTORIES,
    SERVER_DIRECTORY,
} from '#shared/RESERVED_DIRECTORIES.ts'
import { DIRECTORY_FILES, routeOf, skipped } from '#shared/routePattern.ts'

/** What one walk of the app finds, every path relative to the root. */
type AppFiles = {
    /** Every `.abide`, in path order. */
    abide: string[]
    /** Every handler file, in path order. */
    handlers: string[]
    /** Every module under a `server` or a `lib` directory, in path order — run as it is imported. */
    modules: string[]
    /** Every file under a `public` directory, to the address it is answered at below the mount. */
    published: Map<string, string>
}

/** Told of each thing the tree refuses, at the path relative to the root. */
type Refuse = (path: string, message: string) => void

const THROW: Refuse = (_path, message) => {
    throw new Error(message)
}

/**
 * The app's `.abide` sources, handler files, server and lib modules and public files, refusing a
 * tree 23.16, 23.17, 23.18 or 23.22 forbids.
 *
 * `refuse` throws by default, which is the build's answer; `abide check` collects instead (38.33),
 * and the checker's route table ignores them, since a refused tree is the build's to report.
 *
 * A missing root is an app with nothing in it, not a fault.
 */
export function appFiles(root: string, refuse: Refuse = THROW): AppFiles {
    const files: AppFiles = {
        abide: [],
        handlers: [],
        modules: [],
        published: new Map(),
    }
    // 23.22, 38.25 — a root that is its package's directory holds the package's own files beside its
    // pages.
    const packaged = existsSync(`${root}/package.json`)
    walk(root, '', undefined, files, refuse, packaged)
    files.abide.sort()
    files.handlers.sort()
    files.modules.sort()
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
    packaged = false,
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
        const abide = path.endsWith('.abide')
        if (abide) files.abide.push(path)
        if (reserved === undefined) {
            if (!abide && !isModule(path)) {
                if (packaged && relative === '' && !path.endsWith('.ts'))
                    continue
                refuse(
                    path,
                    `abide: ${path} is directly in an address directory, which holds pages, layouts, error pages and handler files alone. Move it into a lib directory beside it. RULEBOOK 23.22.`,
                )
                continue
            }
            if (!abide) files.handlers.push(path)
            // 23.17 — anything that could answer here would answer in abide's own namespace.
            refuseFrameworkRoute(routeOf(path), path, refuse)
        } else if (DIRECTORY_FILES.has(entry.name))
            refuse(
                path,
                `abide: ${path} is under the ${reserved.name} directory ${reserved.path}, where nothing has an address, and ${entry.name} is a route's name. RULEBOOK 23.18.`,
            )
        else if (reserved.name === PUBLIC_DIRECTORY)
            files.published.set(path, publicAddress(path, reserved.path))
        else if (
            (reserved.name === SERVER_DIRECTORY ||
                reserved.name === LIB_DIRECTORY) &&
            isModule(path)
        )
            files.modules.push(path)
    }
}

/**
 * Whether `path` names a module the app runs — neither a declaration nor a test: directly in an
 * address directory, a handler file rather than a stray.
 */
function isModule(path: string): boolean {
    return (
        path.endsWith('.ts') &&
        !path.endsWith('.d.ts') &&
        !path.endsWith('.test.ts')
    )
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
 * Whether an app lies under `root`: a `.abide` anywhere or a handler file, stopping at the first.
 *
 * 38.26's question, asked of a root before anything is built from it, so asking it of a large tree
 * is as cheap as the tree allows.
 */
export function holdsApp(root: string): boolean {
    return !abideFilesUnder(root, '', true).next().done
}

// Every `.abide` under `directory` — and, where `handlers`, every handler file outside a fence.
function* abideFilesUnder(
    directory: string,
    relative: string,
    handlers = false,
    fenced = false,
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
            yield* abideFilesUnder(
                `${directory}/${entry.name}`,
                `${path}/`,
                handlers,
                fenced || RESERVED_DIRECTORIES.has(entry.name),
            )
        else if (
            path.endsWith('.abide') ||
            (handlers && !fenced && isModule(path))
        )
            yield path
    }
}
