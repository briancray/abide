import { SITE, type SiteGroup, type SitePage } from './SITE.ts'

/** The home page: the index of every group, under the prompt. Not a primitive, so not in `SITE`. */
export const HOME: SitePage = {
    route: '/',
    title: 'abide',
    nav: 'Overview',
    description:
        'Type-safe reactive async interfaces for humans and machines. One type, both sides, no API layer.',
    registry: '',
}

// THE SITE MAP READ BY ROUTE, walked once: every page in reading order, and the group each is in.
const ORDER: SitePage[] = [HOME]
const GROUP_OF = new Map<string, SiteGroup>()
for (const group of SITE)
    for (const page of group.pages) {
        ORDER.push(page)
        GROUP_OF.set(page.route, group)
    }

/** Every page in reading order, the home page first: what the markdown bundle walks. */
export const PAGES: readonly SitePage[] = ORDER

/** The page at `route`, which every docs page is — a route `SITE` does not list throws. */
export function pageAt(route: string): SitePage {
    for (const page of ORDER) if (page.route === route) return page
    throw new Error(`docs: ${route} is not in SITE`)
}

/** Whether `route` is a page of the site, rather than the rulebook or a page of the CRM. */
export function isSitePage(route: string): boolean {
    for (const page of ORDER) if (page.route === route) return true
    return false
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
    const at = ORDER.indexOf(pageAt(route))
    return { previous: ORDER[at - 1], next: ORDER[at + 1] }
}

/** The page's markdown twin: the same words at the same place, with `.md` on the end. */
export function markdownAddressOf(route: string): string {
    return route === '/' ? '/index.md' : `${route}.md`
}

/**
 * Whether `pathname` is a page of the CRM, mounted where the CRM serves it so an example's requests
 * reach it here: that app rather than the site, so served with none of the site around it (40.37).
 */
export function isFramed(pathname: string): boolean {
    return pathname !== '/rulebook' && !isSitePage(pathname)
}
