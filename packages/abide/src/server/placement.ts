// WHERE A FILE SITS IN AN APP, AND SO WHAT IT IS — answered once per file, off the path it answers by
// (its POSITION, 23.19), and read by every walk, fence, emit and check rather than re-derived beside
// each. The route GRAMMAR is `routePattern`'s, which the browser's router reads too; this half is the
// build's and the server's alone, so it stays out of the client's closure.

import { LAUNCHER_PAGE } from '#shared/LAUNCHER_FILES.ts'
import { RESERVED_DIRECTORIES } from '#shared/RESERVED_DIRECTORIES.ts'

/** Where a file sits in an app, which is what it is to every reader (`placeOf`). */
export type Place = 'address' | 'public' | 'lib' | 'dependency' | 'skipped'

/** Whether a `.abide` is a page, a layout, an error page or a component. */
type FileKind = 'page' | 'layout' | 'error' | 'component'

/** One file placed in the app: where it is, where it answers by, and what that makes it. */
export type Placement = {
    /** Below the root for the app's own, and above it — `../node_modules/…` — for a dependency's. */
    relative: string
    /** 23.19 — the path it answers by: its own below the root, or the one its mount gives it. */
    position: string
    place: Place
    /** 23.21 — what a `.abide` at `position` is; a handler file is read as a page would be. */
    kind: FileKind
    /** 23.14 — the route of a page, a layout or an error page, and `undefined` for a component. */
    route: string | undefined
    /** 37.1 — the route its hooks and private handlers are filed at. */
    scope: string
    /**
     * 34.23 — a package's file, by where it LIES rather than where it answers: compiled on the app's
     * runtime (34.26), and reported on by its package rather than the app.
     */
    dependency: boolean
}

/**
 * The file at `relative` placed at `position`.
 *
 * 23.21 — WHERE IT SITS, THEN ITS NAME. Every `.abide` directly in an address directory is a page
 * but a `layout.abide`, an `error.abide` and the root's `launcher.abide`; one under a fence is a
 * component whatever it is called. 37.1 — its hooks are filed at an address's own route; under a
 * `lib` directory, at the route of the directory holding it, so a component an admin page renders
 * runs under the admin route's rungs; under a `public` directory, for a dependency's file, and for
 * the launcher (38.82), at the root's.
 *
 * `position` is RELATIVE TO THE APP'S ROOT: its directories are its route, so an absolute path would
 * read the machine's directories as the app's.
 */
export function placement(relative: string, position = relative): Placement {
    const place = placeOf(position)
    let kind: FileKind = 'component'
    let scope = '/'
    if (place === 'address' && position !== LAUNCHER_PAGE) {
        const name = position.slice(position.lastIndexOf('/') + 1)
        kind =
            name === 'layout.abide'
                ? 'layout'
                : name === 'error.abide'
                  ? 'error'
                  : 'page'
        scope = routeOf(position)
    } else if (place === 'lib') {
        const parts = position.split('/')
        // The fence `placeOf` named is the first one, and its name is its place.
        scope = `/${parts.slice(0, parts.indexOf(place)).join('/')}`
    }
    return {
        relative,
        position,
        place,
        kind,
        route: kind === 'component' ? undefined : routeOf(position),
        scope,
        dependency: placeOf(relative) === 'dependency',
    }
}

/**
 * Where the file at `path`, relative to the app's root, sits.
 *
 * - `dependency` — 34.24: a package's, outside the root or under `node_modules`, whose directories
 *   are its package's layout and none of the app's;
 * - `skipped` — under a dot directory, which no walk of the app enters;
 * - `public` or `lib` — 23.15: under that fence, the nearest to the root deciding;
 * - `address` — 23.14: everywhere else, its directories the segments of its route.
 *
 * The last part is the file itself, so a path ending in `/` is a directory and every part is read.
 */
export function placeOf(path: string): Place {
    if (path.startsWith('../') || path.startsWith('/')) return 'dependency'
    const parts = path.split('/')
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index] as string
        if (skipped(part))
            return part === 'node_modules' ? 'dependency' : 'skipped'
        if (RESERVED_DIRECTORIES.has(part)) return part as Place
    }
    return 'address'
}

/** 16.29 — whether `path` names a server file, `<name>.server.<extension>`, which only the server loads. */
export function isServerFile(path: string): boolean {
    return SERVER_FILE.test(path)
}

const SERVER_FILE = /[^/]\.server\.[^./]+$/

/** 16.2 — whether `path` names a handler file, `<name>.handler.ts`, whose default export answers at its route. */
export function isHandlerFile(path: string): boolean {
    return path.endsWith('.handler.ts')
}

/** 23.24 — whether `path` names a param file, `<NAME>.param.ts`, declaring the matcher `NAME`. */
export function isParamFile(path: string): boolean {
    return path.endsWith('.param.ts')
}

/** Whether `path` names a test file, which is never an address nor a module the app runs. */
export function isTestFile(path: string): boolean {
    return path.endsWith('.test.ts')
}

/** Whether `path` names a bench file, which `bun run bench` reads and the app never runs. */
export function isBenchFile(path: string): boolean {
    return path.endsWith('.bench.ts')
}

/** Whether `path` names a declaration file, which the checker reads and nothing runs. */
export function isDeclarationFile(path: string): boolean {
    return path.endsWith('.d.ts')
}

/** Whether a walk of the app passes over the entry `name`: a dot file or directory, or `node_modules`. */
export function skipped(name: string): boolean {
    return name.startsWith('.') || name === 'node_modules'
}

/**
 * The route a file answers at — its path below the root without its extension.
 *
 * 23.14 — `media/[id].abide` and `media/getGrid.handler.ts` are `/media/[id]` and `/media/getGrid`; an
 * `index.abide`, a `layout.abide` and an `error.abide` are their directory's.
 */
export function routeOf(path: string): string {
    const parts = path.split('/')
    const file = parts.pop() as string
    // The extension alone: `[...rest].abide` carries dots of its own.
    if (!DIRECTORY_FILES.has(file)) parts.push(file.replace(EXTENSION, ''))
    return `/${parts.filter((part) => part !== '').join('/')}`
}

const EXTENSION = /\.(?:abide|handler\.ts)$/

/** 23.14, 23.18 — the names whose route is their directory's, and so a route's wherever they stand. */
export const DIRECTORY_FILES = new Set([
    'index.abide',
    'layout.abide',
    'error.abide',
])
