// THE FOUR PLACES THE SITE IS, and which of them an address is in. The site bar marks the one
// you are in and the sidebar lists that one's pages — the reference apart from the guides, and
// nothing at all beside an instrument, which is a page with no siblings to navigate between.

import type { RouteLiteral } from 'abide'
import { NAV_ITEMS, type NavGroup } from '#ui/NAV_ITEMS.ts'

/** The site bar's tabs, in order: the docs, the reference, and the two instruments. */
export const SITE_TABS: { href: RouteLiteral; label: string }[] = [
    { href: '/', label: 'Docs' },
    { href: '/reference', label: 'Reference' },
    { href: '/bench', label: 'Bench' },
    { href: '/tests', label: 'Tests' },
]

// The reference is a SECTION of `NAV` rather than a nav of its own, so the coverage gates written
// over `NAV` keep reading one list, and this splits it for display. SPLIT ONCE, so a navigation
// inside one tab hands the sidebar the same array and its loop has nothing to redo.
const GUIDES: NavGroup[] = []
const REFERENCE: NavGroup[] = []
for (const group of NAV_ITEMS)
    (group.section === 'Reference' ? REFERENCE : GUIDES).push(group)
const NONE: NavGroup[] = []

/** The `href` of the site tab a route is in — `/` for any guide page. */
export function tabOf(pathname: string): string {
    for (const tab of SITE_TABS)
        if (
            tab.href !== '/' &&
            (pathname === tab.href || pathname.startsWith(`${tab.href}/`))
        )
            return tab.href
    return '/'
}

/** The nav groups the sidebar lists at a route: guides, reference, or none on an instrument. */
export function sidebarGroupsOf(pathname: string): NavGroup[] {
    const tab = tabOf(pathname)
    return tab === '/' ? GUIDES : tab === '/reference' ? REFERENCE : NONE
}
