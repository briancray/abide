// 23.14 — WHERE AN APP'S ADDRESSES ARE, read off the tree in one walk. A file directly in a directory
// below the root is an address — a page, a layout, an error page or a handler file — and nothing
// else is there but its tests and the param files its segments name (23.22, 23.24); a fence is never one (23.15): `public` holds files answered as
// authored at the path of the directories above it, and `lib` holds the rest, a server file among it
// (23.23). So listing a directory lists its routes.
//
// ONE WALK for the sources, the handler files, the lib modules, and the public files `abide build`
// copies and `abide dev` answers, and the refusals (23.16, 23.17, 23.18, 23.22, 23.23) — each
// file what `placeOf` says of its path, so the walk and every reader of one path agree, and ONE SKIP
// RULE, `skipped`, for every walk of the tree.
//
// A WALK RATHER THAN A GLOB: a glob descends `node_modules` and the build output before a filter
// can drop them.

import { type Dirent, existsSync, readdirSync } from 'node:fs' // bun has no directory listing or sync existence check of its own

import type { Refusals } from '#compiler/Refusals.ts'
import { ABIDE_ADDRESS } from '#shared/ADDRESSES.ts'
import {
    PUBLIC_DIRECTORY,
    RESERVED_DIRECTORIES,
} from '#shared/RESERVED_DIRECTORIES.ts'

import {
    DIRECTORY_FILES,
    isBenchFile,
    isDeclarationFile,
    isHandlerFile,
    isParamFile,
    isServerFile,
    isTestFile,
    placeOf,
    routeOf,
    skipped,
} from './placement.ts'

/** What one walk of the app finds, every path relative to the root. */
type AppFiles = {
    /** Every `.abide`, in path order. */
    abide: string[]
    /** Every handler file, in path order. */
    handlers: string[]
    /** 23.24 — every param file directly in an address directory, in path order. */
    params: string[]
    /** Every module under a `lib` directory, in path order — read for 37.13. */
    modules: string[]
    /** Every file under a `public` directory, to the address it is answered at below the mount. */
    published: Map<string, string>
}

/**
 * The app's `.abide` sources, handler files, lib modules and public files, refusing a tree 23.16,
 * 23.17, 23.18, 23.22 or 23.23 forbids into `refusals`, each at its path below the root.
 *
 * A missing root is an app with nothing in it, not a fault.
 */
export function appFiles(root: string, refusals: Refusals): AppFiles {
    const files: AppFiles = {
        abide: [],
        handlers: [],
        params: [],
        modules: [],
        published: new Map(),
    }
    // 23.22, 38.25 — a root that is its package's directory holds the package's own files beside its
    // pages.
    const packaged = existsSync(`${root}/package.json`)
    walk(root, '', undefined, files, refusals, packaged)
    files.abide.sort()
    files.handlers.sort()
    files.params.sort()
    files.modules.sort()
    return files
}

// `reserved` is the nearest reserved directory above `relative` — its path and its name — or
// `undefined` where none is: what 23.16 refuses is the nesting of two, which is a directory's shape
// rather than a file's place.
function walk(
    directory: string,
    relative: string,
    reserved: { path: string; name: string } | undefined,
    files: AppFiles,
    refusals: Refusals,
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
                    refusals.at(
                        path,
                        new Error(
                            `abide: ${path} is a ${entry.name} directory under the ${reserved.name} directory ${reserved.path}. RULEBOOK 23.16.`,
                        ),
                    )
                within = { path, name: entry.name }
            }
            walk(
                `${directory}/${entry.name}`,
                `${path}/`,
                within,
                files,
                refusals,
            )
            continue
        }
        const place = placeOf(path)
        if (isServerFile(path) && place !== 'lib') {
            refusals.at(
                path,
                new Error(
                    `abide: ${path} is a server file under no lib directory. Move it into a lib directory, beside it or in any directory above it. RULEBOOK 23.23.`,
                ),
            )
            continue
        }
        const abide = path.endsWith('.abide')
        if (abide) files.abide.push(path)
        if (place === 'address') {
            if (
                isTestFile(path) ||
                isBenchFile(path) ||
                isDeclarationFile(path)
            )
                continue
            if (isParamFile(path)) {
                files.params.push(path)
                continue
            }
            if (!abide && !isHandlerFile(path)) {
                if (packaged && relative === '' && !path.endsWith('.ts'))
                    continue
                refusals.at(
                    path,
                    new Error(
                        `abide: ${path} is directly in an address directory, which holds pages, layouts, error pages, handler files, param files, test files, bench files and declaration files alone. ${path.endsWith('.ts') ? 'Name a handler file <name>.handler.ts, or move anything else' : 'Move it'} into a lib directory, beside it or in any directory above it. RULEBOOK 23.22.`,
                    ),
                )
                continue
            }
            if (!abide) files.handlers.push(path)
            // 23.17 — anything that could answer here would answer in abide's own namespace.
            const framework = frameworkRouteRefusal(routeOf(path), path)
            if (framework !== undefined) refusals.at(path, framework)
            continue
        }
        // Any other place is a fence's, and the walk passed through it.
        const fence = reserved as { path: string; name: string }
        if (DIRECTORY_FILES.has(entry.name))
            refusals.at(
                path,
                new Error(
                    `abide: ${path} is under the ${fence.name} directory ${fence.path}, where nothing has an address, and ${entry.name} is a route's name. RULEBOOK 23.18.`,
                ),
            )
        else if (place === 'public')
            files.published.set(path, publicAddress(path, fence.path))
        else if (place === 'lib' && isModule(path)) files.modules.push(path)
    }
}

/** Whether `path` names a module the app runs — neither a declaration, a test nor a bench. */
function isModule(path: string): boolean {
    return (
        path.endsWith('.ts') &&
        !isDeclarationFile(path) &&
        !isTestFile(path) &&
        !isBenchFile(path)
    )
}

/** The refusal of `source` where `route` lies in the framework's own namespace, or `undefined`. 23.17. */
export function frameworkRouteRefusal(
    route: string,
    source: string,
): Error | undefined {
    return route === ABIDE_ADDRESS || route.startsWith(`${ABIDE_ADDRESS}/`)
        ? new Error(
              `abide: ${source} answers at ${route}, which is under ${ABIDE_ADDRESS}, where abide's own addresses are. RULEBOOK 23.17.`,
          )
        : undefined
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
 * Whether an app lies under `root`: a `.abide` anywhere or a handler file, stopping at the first.
 *
 * 38.26's question, asked of a root before anything is built from it, so asking it of a large tree
 * is as cheap as the tree allows.
 */
export function holdsApp(root: string): boolean {
    return !appSourcesUnder(root, '').next().done
}

// Every `.abide` under `directory`, and every handler file whose place is an address.
function* appSourcesUnder(
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
            yield* appSourcesUnder(`${directory}/${entry.name}`, `${path}/`)
        else if (
            path.endsWith('.abide') ||
            (isHandlerFile(path) && placeOf(path) === 'address')
        )
            yield path
    }
}
