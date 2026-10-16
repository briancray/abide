// THE FOUR PLACES THE SITE IS, and which of them an address is in. The site bar marks the one
// you are in and the sidebar lists that one's pages — the reference apart from the guides, and
// nothing at all beside an instrument, which is a page with no siblings to navigate between.
//
// A FIFTH KIND OF ADDRESS IS NONE OF THEM: a page an example card frames, which is the example's
// own app rather than the site's, and is served with none of the site around it (40.39).

import type { RouteLiteral } from '@abide/abide'
import { SITE, type SitePage } from './SITE.ts'

type NavGroup = {
    section: string
    pages: readonly Pick<SitePage, 'route' | 'nav' | 'stub'>[]
}

/** The site bar's tabs, in order: the docs, the reference, and the two instruments. */
export const SITE_TABS: { href: RouteLiteral; label: string }[] = [
    { href: '/', label: 'Docs' },
    { href: '/reference', label: 'Reference' },
    { href: '/bench', label: 'Bench' },
    { href: '/gate', label: 'Tests' },
]

// The reference is a SECTION of `SITE` rather than a nav of its own, so the coverage gates written
// over `SITE` keep reading one list, and this splits it for display. SPLIT ONCE, so a navigation
// inside one tab hands the sidebar the same array and its loop has nothing to redo.
const GUIDES: NavGroup[] = []
const REFERENCE: NavGroup[] = []
for (const group of SITE)
    (group.section === 'Reference' ? REFERENCE : GUIDES).push(group)

/** The documents in the reference tab: pages read off a file in `docs/`, not written in `SITE`. */
export const DOCUMENTS: NavGroup = {
    section: 'Documents',
    pages: [{ route: '/rulebook', nav: 'Rulebook' }],
}
REFERENCE.push(DOCUMENTS)

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

/** Whether `pathname` is a page an example card frames: one below a `frame` directory. */
export function isFramed(pathname: string): boolean {
    return pathname.includes('/frame/') || pathname.endsWith('/frame')
}

/** The nav groups the sidebar lists at a route: guides, reference, or none on an instrument. */
export function sidebarGroupsOf(pathname: string): NavGroup[] {
    if (isFramed(pathname)) return NONE
    const tab = tabOf(pathname)
    return tab === '/' ? GUIDES : tab === '/reference' ? REFERENCE : NONE
}
