// 51.136-51.140 — `breadcrumbs`, its parts read as a template reads them.

import { expect, test } from 'bun:test'

import { breadcrumbs, flushSync, reactive } from '#shared'

type Crumb = { name: string; path: string }
const TRAIL: Crumb[] = [
    { name: 'Home', path: '/' },
    { name: 'Companies', path: '/companies' },
    { name: 'Analytical', path: '/companies/analytical' },
    { name: 'Deals', path: '/companies/analytical/deals' },
    { name: 'Engine renewal', path: '/deals/d1' },
]
const names = (items: readonly (Crumb | 'overflow')[]) =>
    items.map((item) => (item === 'overflow' ? '…' : item.name))

// THE REVERT: keep the first `max` crumbs rather than the first and the last, and the page itself is
// folded away.
test('past max, the first crumb and the last stay, the middle folded — 51.136, 51.137', () => {
    const max = reactive(3)
    const crumbs = breadcrumbs({
        trail: TRAIL,
        href: (crumb) => crumb.path,
        max,
    })
    expect(names(crumbs.items)).toEqual([
        'Home',
        '…',
        'Deals',
        'Engine renewal',
    ])
    expect(crumbs.folded.map((crumb) => crumb.name)).toEqual([
        'Companies',
        'Analytical',
    ])
    max.set(10)
    flushSync()
    expect(names(crumbs.items)).toHaveLength(5)
    expect(crumbs.folded).toEqual([])
})

// THE REVERT: drop `aria-current` from a crumb's link, and the page reads like any link.
test('each crumb links to its address, the page itself current, and the folded ones are menu items — 51.138, 51.139, 51.140', () => {
    const crumbs = breadcrumbs({
        trail: TRAIL,
        href: (crumb) => crumb.path,
        max: 3,
    })
    const last = TRAIL[4] as Crumb
    expect([crumbs.link(last).href, crumbs.link(last)['aria-current']]).toEqual(
        ['/deals/d1', 'page'],
    )
    expect(crumbs.link(TRAIL[0] as Crumb)['aria-current']).toBeUndefined()
    expect(crumbs.menuItem(TRAIL[1] as Crumb)).toMatchObject({
        role: 'menuitem',
        href: '/companies',
    })
    expect(crumbs.overflow.trigger['aria-haspopup']).toBe('menu')
    expect(crumbs.nav['aria-label']).toBe('Breadcrumb')
})
