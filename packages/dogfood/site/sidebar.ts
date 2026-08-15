// The one shape a sidebar is built out of, and nothing else.
//
// Here rather than inline on the component because it is written twice — once by `sidebar.abide`'s
// props and once by whoever builds the list. The sidebar itself is deliberately ignorant of WHICH list
// it is showing: `/docs` is keyed by callable and `/tests` and `/bench` by capability, two vocabularies
// with one shape, and a component that knew the difference would carry a branch per page.
//
// ─── WHY THERE IS NO SECOND LEVEL ───────────────────────────────────────────────────────────────────
// The nav lists PAGES and stops there. It was built once with the current page's rungs nested under it,
// the way `brand/gallery.html` draws it, and that is an isomorphism break rather than a design choice:
// a rung list has to be loaded, the sidebar renders in the LAYOUT — before the page — and the server
// had the ladder settled by the time that slot ran while a browser, fetching the chunk over a network,
// did not. Server wrote the rows, client wrote none, and the top-level part rebuilt the whole page it
// had been handed correct markup for. `e2e/hydration.e2e.ts` is what says so.
//
// Anything the sidebar shows must therefore be knowable WITHOUT a load. A page's own contents are not.

/** One entry: the page it goes to, and the name it goes by. Current is decided by the address, not here. */
export interface NavItem {
    href: string
    label: string
}
