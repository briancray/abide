// A pages directory as a route table.
//
// The DIRECTORY is the pattern and the FILENAME is the kind — `page` is a route, `layout` wraps
// every route under it — so a route's address is legible in a file tree and there is nothing to keep
// in step with a list somewhere else. A scan rather than the registration a transport module uses
// for `server/rpc/**`, because a route has to be reachable BEFORE its module is imported: that is
// the whole point of a loader, and a `register(…)` call inside the page cannot run until it is.
//
// Server-only, and the one part of routing that is: a filesystem is not isomorphic. What it produces
// is an ordinary `RouteEntry[]`, which `routes()` takes on either side — so a client that cannot
// scan a directory is handed the same table by whatever built its bundle.
//
// The loaders are dynamic imports, which is what makes a page's code absent until someone asks for
// it. A `.abide` page needs the compiler plugin registered (`abide/compiler/preload`), exactly as
// importing one by hand does.

import type { Loader, RouteEntry, ViewModule } from '#shared/router.ts'

const PAGE = 'page.'
const LAYOUT = 'layout.'
const ERROR = 'error.'

/**
 * One route as FILES — the table before anything can be loaded, and the shape `source` records.
 *
 * Paths are relative to the pages directory, in the order an outer layout wraps an inner one. This is
 * what a LOADER is built over on the server and what an `import()` is WRITTEN over by the build that
 * makes the client's table — one walk, so the two tables cannot disagree about which layouts are
 * above a route.
 */
export interface PageFiles {
    path: string
    page: string
    layouts: string[]
    /**
     * What this row IS. An `error` row is not addressable — nothing routes to it — but it is carried
     * in the same table for the reason the doc comment below gives: the generator, the binary and the
     * server each build loaders off ONE walk, and an error page absent from any of them is a section
     * whose failures fall back to JSON on that lane alone.
     *
     * Its `path` is the DIRECTORY it covers rather than an address, so `/docs` here is every route
     * under `/docs` — see `errorFor`, which is the only thing that reads it.
     */
    kind: 'page' | 'error'
}

/**
 * Every `page.abide` / `page.ts` under `dir`, with the `layout` files above each one attached
 * outermost first — as paths, before a loader exists for any of them. `error.abide` rides in the
 * same table under its own `kind`.
 *
 * Separate from `pages()` because the client's table is written by a BUILD rather than by a scan: a
 * browser has no directory to read, so the codegen emits a static `import()` per row from exactly
 * this list. A second walk written beside the generator is a layout that wraps a route on one side
 * and not the other, with nothing saying so.
 *
 * Not sorted: precedence belongs to `routes()`, which is also where a hand-written table gets it.
 */
export async function pageFiles(dir: string | URL): Promise<PageFiles[]> {
    const root = typeof dir === 'string' ? dir : Bun.fileURLToPath(dir)
    const glob = new Bun.Glob('**/{page,layout,error}.{abide,ts}')

    // Directory relative to the root (`''` is the root itself) to the whole relative path, which is
    // what a loader and a diagnostic both want.
    const layouts = new Map<string, string>()
    const found = new Map<string, string>()
    const errors = new Map<string, string>()
    for await (const entry of glob.scan({ cwd: root, onlyFiles: true })) {
        const file = entry.replaceAll('\\', '/')
        const cut = file.lastIndexOf('/')
        const inside = cut === -1 ? '' : file.slice(0, cut)
        const name = cut === -1 ? file : file.slice(cut + 1)
        // The brace glob admits any of the three, so which one this is decides the map AND the word a
        // collision is reported with. Three names, so a ternary chain would be the last place a
        // fourth kind is remembered.
        let into: Map<string, string> | null = null
        let kind = ''
        if (name.startsWith(LAYOUT)) {
            into = layouts
            kind = 'layout'
        } else if (name.startsWith(PAGE)) {
            into = found
            kind = 'page'
        } else if (name.startsWith(ERROR)) {
            into = errors
            kind = 'error page'
        }
        if (into === null) continue
        const held = into.get(inside)
        if (held !== undefined) collision(held, file, kind)
        into.set(inside, file)
    }

    // Relative to the pages directory: whoever reads this knows where that is, and a path anchored to
    // this process's cwd would be one no manifest could be keyed by and no generated import could be
    // written from.
    const table: PageFiles[] = []
    // The two kinds build the same row, so they build it in one place: an error page's layouts are
    // the ones above ITS OWN directory, which is what keeps a 404 under `/docs` inside the docs
    // sidebar, and its own directory's layout counts — a section's chrome is what the section's
    // failure should still be wearing. That is `layoutsAbove` either way.
    for (const [kind, from] of [
        ['page', found],
        ['error', errors],
    ] as const) {
        for (const [inside, file] of from) {
            table.push({
                path: inside === '' ? '/' : `/${inside}`,
                page: file,
                layouts: layoutsAbove(inside, layouts),
                kind,
            })
        }
    }
    return table
}

/**
 * Every layout from the root down to `inside`, outermost first — so an outer layout reaches in and an
 * inner one never reaches out, the same containment a nested `<style>` has.
 *
 * Shared by the two kinds of row rather than written twice: an error page that rendered in a
 * different set of layouts from the pages beside it is a 404 whose chrome does not match the section
 * it happened in, and nothing would say so.
 */
function layoutsAbove(inside: string, layouts: Map<string, string>): string[] {
    const wrapFiles: string[] = []
    const outermost = layouts.get('')
    if (outermost !== undefined) wrapFiles.push(outermost)
    if (inside === '') return wrapFiles
    let at = 0
    for (;;) {
        const cut = inside.indexOf('/', at)
        const prefix = cut === -1 ? inside : inside.slice(0, cut)
        const held = layouts.get(prefix)
        if (held !== undefined) wrapFiles.push(held)
        if (cut === -1) break
        at = cut + 1
    }
    return wrapFiles
}

/**
 * The same table with a loader per file — what `routes()` is handed on the server.
 *
 * The loaders are dynamic imports, which is what makes a page's code absent until someone asks for
 * it. `source` carries the files through unchanged, because a loader is a closure and a closure has
 * no address: it is the only record of which file a route's code is in, and a route's chunk cannot be
 * named in a document without one.
 */
export async function pages(dir: string | URL): Promise<RouteEntry[]> {
    const root = typeof dir === 'string' ? dir : Bun.fileURLToPath(dir)
    return pagesFrom(root, await pageFiles(root))
}

/**
 * The same table, from a walk somebody already did.
 *
 * `abide dev` needs this list twice per save — once to generate the client entry, once to build the
 * server's routes — and the two scans are the same recursive glob of the same directory a few
 * milliseconds apart. Split rather than cached because a rebuild MUST re-scan: a page added is a row
 * the table has to grow, which is the whole reason the entry is regenerated per save.
 *
 * `written` is the other way a loader can arrive: a `.abide` page inside a compiled binary is not a
 * file any more, so `abide compile` emits an `import()` per row exactly as the client lane already
 * does and hands the table down. Keyed by the same relative path the walk produced, so the two
 * spellings of a route are one string. A file with no loader in there is a page the generator did
 * not see, which is a broken table rather than a route to resolve at runtime — hence the throw.
 */
export function pagesFrom(root: string, found: PageFiles[], written?: Record<string, Loader>): RouteEntry[] {
    // One loader per FILE, not per file per page: a root layout is above every route in the table,
    // and building it once per page would parse the same URL and hold a distinct closure for each.
    // A generated table is already one thunk per file, so it is read rather than rebuilt.
    if (written !== undefined) return rows(found, (file) => loaderNamed(written, file))

    const base = Bun.pathToFileURL(root.endsWith('/') ? root : `${root}/`)
    const loaders = new Map<string, Loader>()
    const loaderFor = (file: string): Loader => {
        let held = loaders.get(file)
        if (held === undefined) {
            const href = new URL(file, base).href
            held = () => import(href) as Promise<ViewModule>
            loaders.set(file, held)
        }
        return held
    }
    return rows(found, loaderFor)
}

function loaderNamed(written: Record<string, Loader>, file: string): Loader {
    const held = written[file]
    if (held === undefined) throw new Error(`abide: no loader was generated for "${file}"`)
    return held
}

function rows(found: PageFiles[], loaderFor: (file: string) => Loader): RouteEntry[] {
    const table: RouteEntry[] = []
    for (const entry of found) {
        const wraps: Loader[] = []
        for (const wrapFile of entry.layouts) wraps.push(loaderFor(wrapFile))
        table.push({
            path: entry.path,
            page: loaderFor(entry.page),
            layouts: wraps,
            kind: entry.kind,
            source: { page: entry.page, layouts: entry.layouts },
        })
    }
    return table
}

function collision(first: string, second: string, kind: string): never {
    throw new Error(
        `abide: "${first}" and "${second}" are two ${kind}s for one directory — a directory is one route`,
    )
}
