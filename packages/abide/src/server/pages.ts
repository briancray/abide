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

import type { Loader, RouteEntry, ViewModule } from '$shared/router.ts'

const PAGE = 'page.'
const LAYOUT = 'layout.'

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
}

/**
 * Every `page.abide` / `page.ts` under `dir`, with the `layout` files above each one attached
 * outermost first — as paths, before a loader exists for any of them.
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
    const glob = new Bun.Glob('**/{page,layout}.{abide,ts}')

    // Directory relative to the root (`''` is the root itself) to the whole relative path, which is
    // what a loader and a diagnostic both want.
    const layouts = new Map<string, string>()
    const found = new Map<string, string>()
    for await (const entry of glob.scan({ cwd: root, onlyFiles: true })) {
        const file = entry.replaceAll('\\', '/')
        const cut = file.lastIndexOf('/')
        const inside = cut === -1 ? '' : file.slice(0, cut)
        const name = cut === -1 ? file : file.slice(cut + 1)
        const into = name.startsWith(LAYOUT) ? layouts : name.startsWith(PAGE) ? found : null
        if (into === null) continue
        const held = into.get(inside)
        if (held !== undefined) collision(held, file, into === layouts ? 'layout' : 'page')
        into.set(inside, file)
    }

    // Relative to the pages directory: whoever reads this knows where that is, and a path anchored to
    // this process's cwd would be one no manifest could be keyed by and no generated import could be
    // written from.
    const table: PageFiles[] = []
    for (const [inside, file] of found) {
        // Every directory from the root down to the page's own, so an outer layout reaches in and an
        // inner one never reaches out — the same containment a nested `<style>` has.
        const wrapFiles: string[] = []
        const outermost = layouts.get('')
        if (outermost !== undefined) wrapFiles.push(outermost)
        if (inside !== '') {
            let prefix = ''
            let at = 0
            for (;;) {
                const cut = inside.indexOf('/', at)
                prefix = cut === -1 ? inside : inside.slice(0, cut)
                const held = layouts.get(prefix)
                if (held !== undefined) wrapFiles.push(held)
                if (cut === -1) break
                at = cut + 1
            }
        }
        table.push({ path: inside === '' ? '/' : `/${inside}`, page: file, layouts: wrapFiles })
    }
    return table
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
 */
export function pagesFrom(root: string, found: PageFiles[]): RouteEntry[] {
    const base = Bun.pathToFileURL(root.endsWith('/') ? root : `${root}/`)

    // One loader per FILE, not per file per page: a root layout is above every route in the table,
    // and building it once per page would parse the same URL and hold a distinct closure for each.
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

    const table: RouteEntry[] = []
    for (const entry of found) {
        const wraps: Loader[] = []
        for (const wrapFile of entry.layouts) wraps.push(loaderFor(wrapFile))
        table.push({
            path: entry.path,
            page: loaderFor(entry.page),
            layouts: wraps,
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
