// The client lane an app did not write — generated from `pages/`, because the table is already on
// disk and a browser is the only thing that cannot read it.
//
// `pages()` is a directory scan, and that is the whole reason a client entry has been hand-written
// until now: the server reads the tree, the browser has no tree, so somebody retypes the same table
// with a static `import()` per row. The `import()` is load-bearing — a call the bundler can SEE is a
// chunk, which is what keeps a page absent from the first load — but the TEXT of it is mechanical,
// and mechanical text restated by hand is a route that renders on the server and 404s in the browser
// the first time somebody adds a page and forgets the other list.
//
// So it is written here, from `pageFiles` — the same walk `pages()` builds its loaders over, so the
// two tables cannot disagree about which layouts wrap a route.
//
// Written into `.abide/` rather than beside the app's own source, for three reasons that all say the
// same thing: it is a build artifact, it is already gitignored, and `abide dev`'s watcher already
// ignores the directory — so regenerating on every rebuild is not a save that triggers a rebuild.
//
// There is no app-written override. The lane is ALWAYS this file, because everything an app used to
// put in a hand-written `client.ts` — a click handler, an analytics call, anything that runs once in
// the browser — belongs in `pages/layout.abide`, which is above every route and already isomorphic.
// One lane with one shape is what lets the routing boilerplate leave every app at once.

import { type PageFiles, pageFiles } from '$server/pages.ts'
import { CLIENT_ENTRIES, firstPresent, PAGES } from '../CLIENT_BUILD.ts'

/** The generated lane, relative to the project root. Under `.abide/`, beside the build it feeds. */
export const GENERATED_ENTRY = '.abide/client.entry.ts'

/**
 * The client lane at `root`, written from `pages/`.
 *
 * `null` is an app with no pages: nothing for a browser to be handed, which is an app made of
 * endpoints. Both commands that bundle go through here, so `abide dev` and `abide build` cannot be
 * pointed at different modules.
 */
export async function clientLane(root: string): Promise<string | null> {
    // Said out loud, because it is otherwise the quietest kind of breakage: the app still builds and
    // still runs, and the only symptom is that whatever was in that file stopped happening. Here
    // rather than in either command, so `abide dev` and `abide build` cannot warn differently.
    const ignored = await firstPresent(root, CLIENT_ENTRIES)
    if (ignored !== null) {
        console.error(`abide: ${ignored} is not built — the client lane is generated from ${PAGES}/`)
        console.error('       client-side code of your own goes in pages/layout.abide')
    }

    const table = await pageFiles(`${root}/${PAGES}`).catch(() => [])
    if (table.length === 0) return null

    const path = `${root}/${GENERATED_ENTRY}`
    await Bun.write(path, source(table))
    return path
}

/**
 * The lane, as text.
 *
 * Sorted by route path, so two builds of one tree produce the same bytes — a generated file that
 * reshuffles per scan is a content hash that changes for nothing and a diff nobody can read.
 *
 * The imports are `abide` / `abide/ui` — the app's own dependency by its PUBLIC specifier, resolved
 * from `.abide/` upward like any other module here. A relative path into the framework would resolve
 * past the app's `exports` map and bundle a private file.
 */
function source(table: PageFiles[]): string {
    const rows = table.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

    // One const per layout FILE, for the reason `pages()` memoizes its loaders: a root layout is
    // above every route, and a fresh `() => import(…)` per row is N modules the bundler cannot see
    // are one.
    const named = new Map<string, string>()
    let hoisted = ''
    for (const row of rows) {
        for (const layout of row.layouts) {
            if (named.has(layout)) continue
            const name = `layout${named.size}`
            named.set(layout, name)
            hoisted += `const ${name} = (): Promise<ViewModule> => import(${quoted(layout)})\n`
        }
    }

    let entries = ''
    for (const row of rows) {
        const wraps: string[] = []
        for (const layout of row.layouts) wraps.push(named.get(layout) as string)
        entries +=
            `    { path: ${JSON.stringify(row.path)},` +
            ` page: (): Promise<ViewModule> => import(${quoted(row.page)}),` +
            ` layouts: [${wraps.join(', ')}] },\n`
    }

    return `${HEADER}import { navigate, outlet, ready, routes, type ViewModule } from 'abide'
import { hydrate } from 'abide/ui'

${hoisted}
routes([
${entries}])

// The page's own module, BEFORE adopting anything: a page here is a chunk that has not arrived yet,
// so hydrating first would adopt against a tree with a hole where the server wrote content. This is
// the same call the server makes before it renders, and it is what makes the two snapshots one.
await ready()

// The \`<slot>\` the server rendered the page INTO, so what hydrates is what was written.
const root = document.querySelector('slot')
if (root !== null) hydrate(root, outlet)

// An ordinary link, intercepted. \`navigate\` does not commit the route until the page's chunk has
// arrived, which is the whole of what \`route().navigating\` reports.
document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.('a[href^="/"]')
    if (link === null || link === undefined) return
    event.preventDefault()
    void navigate(link.getAttribute('href') as string)
})
`
}

const HEADER = `// GENERATED from pages/ by \`abide build\` / \`abide dev\`. Edits here are overwritten on the next
// build — client-side code of your own goes in \`pages/layout.abide\`, which is above every route.
`

/** A page file as a specifier from `.abide/`, which is one directory below the pages directory. */
function quoted(file: string): string {
    return JSON.stringify(`../${PAGES}/${file}`)
}
