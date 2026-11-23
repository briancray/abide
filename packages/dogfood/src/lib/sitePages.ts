import { SITE, type SiteGroup, type SitePage } from './SITE.ts'

/** The home page: the index of every group, under the prompt. Not a primitive, so not in `SITE`. */
const HOME: SitePage = {
    route: '/',
    title: 'abide',
    nav: 'Overview',
    description:
        'Type-safe reactive async interfaces for humans and machines. One type, both sides, no API layer.',
    registry: '',
    where: 'anywhere',
    subgroup: undefined,
}

// THE SITE MAP READ BY ROUTE, walked once: every page in reading order, and the group each is in.
const ORDER: SitePage[] = [HOME]
const INDEX_OF = new Map<string, number>([[HOME.route, 0]])
const GROUP_OF = new Map<string, SiteGroup>()
const ROUTE_OF_SECTION = new Map<string, string>()
for (const group of SITE)
    for (const page of group.pages) {
        INDEX_OF.set(page.route, ORDER.length)
        ORDER.push(page)
        GROUP_OF.set(page.route, group)
        ROUTE_OF_SECTION.set(page.registry, page.route)
    }

/** Every page in reading order, the home page first: what the markdown bundle walks. */
export const PAGES: readonly SitePage[] = ORDER

/** The page at `route`, which every docs page is — a route `SITE` does not list throws. */
export function pageAt(route: string): SitePage {
    const page = sitePageAt(route)
    if (page === undefined) throw new Error(`docs: ${route} is not in SITE`)
    return page
}

/** The page at `route`, or `undefined` for the rulebook or a page of the CRM. */
export function sitePageAt(route: string): SitePage | undefined {
    const at = INDEX_OF.get(route)
    return at === undefined ? undefined : ORDER[at]
}

/** The route of the page a REGISTRY section is documented on, or `''` where none is. */
export function routeOfSection(section: string): string {
    return ROUTE_OF_SECTION.get(section) ?? ''
}

/** The group a page is listed under, or `undefined` for the home page. */
export function groupOf(route: string): SiteGroup | undefined {
    return GROUP_OF.get(route)
}

/** The pages before and after `route` in reading order. */
export function neighborsOf(route: string): {
    previous: SitePage | undefined
    next: SitePage | undefined
} {
    const at = INDEX_OF.get(route)
    if (at === undefined) throw new Error(`docs: ${route} is not in SITE`)
    return { previous: ORDER[at - 1], next: ORDER[at + 1] }
}

/** A group's pages in their runs, each under its label, or one run with none where it has no runs (40.37). */
export function runsOf(
    group: SiteGroup,
): { label: string | undefined; pages: SitePage[] }[] {
    const runs: { label: string | undefined; pages: SitePage[] }[] = []
    for (const page of group.pages) {
        const last = runs.at(-1)
        if (last !== undefined && last.label === page.subgroup)
            last.pages.push(page)
        else runs.push({ label: page.subgroup, pages: [page] })
    }
    return runs
}

/** The page's markdown twin: the same words at the same place, with `.md` on the end. */
export function markdownAddressOf(route: string): string {
    return route === '/' ? '/index.md' : `${route}.md`
}

/**
 * Whether `pathname` is a page of the CRM, mounted where the CRM serves it so an example's requests
 * reach it here: that app rather than the site, so served with none of the site around it (40.24).
 */
export function isFramed(pathname: string): boolean {
    return pathname !== '/rulebook' && !INDEX_OF.has(pathname)
}
