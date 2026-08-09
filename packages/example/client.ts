// The example's CLIENT entry — what `abide build` is pointed at. `app.ts` beside it is the other lane.
//
// Two things happen here that cannot happen anywhere else, and they are the two claims the build is
// asserted against:
//
// The route table is written by HAND, with a static `import()` per page. That is the known limit —
// `pages(dir)` reads a directory and a browser has none — and it is also exactly what makes the
// bundle splittable: an `import()` the bundler can SEE is a chunk, so `/users/[id]`'s page is absent
// from the first load and arrives when somebody navigates. A table built by scanning at runtime would
// ship every page in the entry.
//
// It splits twice over. `/[suite]/[...rest]` is one page for twenty capability suites, and the suite
// itself arrives through a second `import()` — so the entry holds no suite at all, and `/state` never
// loads the TypeScript scanner that `/compiler` needs.
//
// And it imports an endpoint from `server/rpc/users.ts` by the same name the server does. In this
// lane that module elides to `remote("users/getUser")`, so `server/db.ts` — a driver with a
// module-level side effect a bundler may not drop — never enters the graph at all. The build test
// asserts its marker is absent from every byte written, because "the server half does not ship" is a
// claim about the output rather than about the option that produced it.

import { navigate, outlet, ready, route, routes } from 'abide'
import { hydrate } from 'abide/ui'
import { getUser } from './server/rpc/users.ts'

// The one layout above every page, as ONE loader rather than one per row: a root layout is above the
// whole table, and a fresh closure per route would be five modules the bundler cannot see are one.
const CHROME = (): Promise<typeof import('./pages/layout.abide')> => import('./pages/layout.abide')

routes([
    {
        path: '/',
        page: () => import('./pages/page.abide'),
        layouts: [CHROME],
    },
    {
        // Twenty routes and one page: the segment names the suite, and `[...rest]` is what keeps the
        // routing card's own navigations inside the page they are made from. This is the row the
        // splitting claim rests on — the page's chunk holds no suite, and each suite arrives when
        // somebody asks for it.
        path: '/[suite]/[...rest]',
        page: () => import('./pages/[suite]/[...rest]/page.abide'),
        layouts: [CHROME],
    },
    {
        path: '/bench',
        page: () => import('./pages/bench/page.abide'),
        layouts: [CHROME],
    },
    {
        // The one route that SUSPENDS. Its whole job is to be slow in a knowable way, so the gap
        // between what a document render streams and what a navigation waits for is a number off the
        // wire rather than a claim — see `test/start.test.ts`.
        path: '/streaming',
        page: () => import('./pages/streaming/page.abide'),
        layouts: [CHROME],
    },
    {
        path: '/users/[id]',
        page: () => import('./pages/users/[id]/page.abide'),
        layouts: [CHROME, () => import('./pages/users/layout.abide')],
    },
    {
        path: '/files/[...path]',
        page: () => import('./pages/files/[...path]/page.abide'),
        layouts: [CHROME],
    },
])

// The page's own module, BEFORE adopting anything. The server rendered this route with its page in
// it, and a page here is a chunk that has not arrived yet — so hydrating first would adopt against a
// tree with a hole where the server wrote content, warn about the mismatch, and rebuild the subtree
// it was supposed to be taking over. `ready()` is the same call the server makes before it renders,
// and it is what makes the two snapshots the same one.
await ready()

// The `<slot>` in `app.html` — the same element the server rendered the page INTO, so what hydrates
// is what was written. It is `display: contents`, so adopting it costs the page no box.
const root = document.querySelector('slot')
if (root !== null) hydrate(root, outlet)

// An ordinary link, intercepted: the page it names is a chunk that is not here yet, and `navigate`
// does not commit the route until it has arrived — which is the whole of what `route().navigating`
// reports.
document.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest?.('a[href^="/"]')
    if (link === null || link === undefined) return
    event.preventDefault()
    void navigate(link.getAttribute('href') as string)
})

// The endpoint, called from the browser: this is the stub's address and nothing else, and reading the
// slot is what reaches over the wire.
//
// The refusal is narrowed here, in the lane that has none of the declaration in it. `getUser` returns
// its `NoSuchUser` failure rather than throwing it, so the name and the shape are in the handler's
// TYPE — and the type is all that crosses: the schema that checks the data is server-side text this
// bundle never sees, and `caught.data.id` still has a number in it on this side.
export async function nameOf(id: number): Promise<string> {
    const slot = getUser({ id })
    try {
        return (await slot).name
    } catch (caught) {
        // The message deliberately does not spell the word the `/users/[id]` page renders: the build
        // test probes the entry for that text to prove the page is a chunk of its own.
        if (slot.isError(caught, 'NoSuchUser')) return `nobody with id ${caught.data.id}`
        throw caught
    }
}

export { route }
