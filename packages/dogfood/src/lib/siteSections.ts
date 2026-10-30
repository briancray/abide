// THE TWO PLACES THE SITE IS, and which of them an address is in. The site bar marks the one you
// are in and the sidebar lists that one's pages — the reference apart from the guide.
//
// A THIRD KIND OF ADDRESS IS NEITHER: a chapter app's page, mounted at the address its own app
// serves it at so its cards' requests reach it, which is that app rather than the site and is served
// with none of the site around it (40.37).

import type { RouteLiteral } from '@abide/abide'

import { REFERENCE } from './REFERENCE.ts'
import type { SitePage } from './SITE.ts'
import { SECTIONS } from './sitePages.ts'

type NavGroup = {
    section: string
    pages: readonly Pick<SitePage, 'route' | 'nav' | 'stub'>[]
}

/** The site bar's tabs, in order: the guide and the reference. */
export const SITE_TABS: { href: RouteLiteral; label: string }[] = [
    { href: '/', label: 'Docs' },
    { href: '/reference', label: 'Reference' },
]

// The reference is a SECTION of `SITE` rather than a nav of its own, so the coverage gates written
// over `SITE` keep reading one list, and this splits it for display — its overview on its own, then
// its pages under the REGISTRY group `REFERENCE.ts` files each in. SPLIT ONCE, so a navigation
// inside one tab hands the sidebar the same array and its loop has nothing to redo.
const GROUP_OF = new Map<string, string>()
for (const page of REFERENCE) GROUP_OF.set(page.route, page.group)
const GUIDES: NavGroup[] = []
const REFERENCE_NAV: NavGroup[] = []
for (const group of SECTIONS) {
    if (group.section !== 'Reference') {
        GUIDES.push(group)
        continue
    }
    const grouped = new Map<string, NavGroup['pages'][number][]>()
    const overview: NavGroup['pages'][number][] = []
    for (const page of group.pages) {
        const filed = GROUP_OF.get(page.route)
        if (filed === undefined) {
            overview.push(page)
            continue
        }
        const pages = grouped.get(filed) ?? []
        pages.push(page)
        grouped.set(filed, pages)
    }
    REFERENCE_NAV.push({ section: group.section, pages: overview })
    for (const [section, pages] of grouped)
        REFERENCE_NAV.push({ section, pages })
}

/** The documents in the reference tab: pages read off a file in `docs/`, not written in `SITE`. */
export const DOCUMENTS: NavGroup = {
    section: 'Documents',
    pages: [{ route: '/rulebook', nav: 'Rulebook' }],
}
REFERENCE_NAV.push(DOCUMENTS)

const NONE: NavGroup[] = []

/** The `href` of the site tab a route is in — `/` for any guide page. */
export function tabOf(pathname: string): string {
    for (const document of DOCUMENTS.pages)
        if (pathname === document.route) return '/reference'
    for (const tab of SITE_TABS)
        if (
            tab.href !== '/' &&
            (pathname === tab.href || pathname.startsWith(`${tab.href}/`))
        )
            return tab.href
    return '/'
}

/** Whether `pathname` is a chapter app's page: neither the guide, the reference nor a document. */
export function isFramed(pathname: string): boolean {
    return (
        pathname !== '/' &&
        !pathname.startsWith('/guide/') &&
        tabOf(pathname) !== '/reference'
    )
}

/** The nav groups the sidebar lists at a route: the guide, the reference, or none on an app's page. */
export function sidebarGroupsOf(pathname: string): NavGroup[] {
    if (isFramed(pathname)) return NONE
    return tabOf(pathname) === '/reference' ? REFERENCE_NAV : GUIDES
}
