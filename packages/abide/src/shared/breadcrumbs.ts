// 51.136-51.140 — WHERE THE PAGE STANDS IN WHAT HOLDS IT: a trail of links, the last the page itself,
// as parts an app spreads onto a nav and links of its own. Past `max`, the middle folds into a
// `menu`, handed back whole under its name (49.18), its crumbs the menu's items.

import { type Live, live } from './live.ts'
import { type Menu, menu } from './menu.ts'

/** The trail, where each crumb leads, how many show before the middle folds, and the nav's name. */
export type BreadcrumbsOptions<Crumb> = {
    /** The crumbs from the top down, the last the page itself; a function is read live. */
    trail: Live<readonly Crumb[]>
    /** The address a crumb leads to. */
    href: (crumb: Crumb) => string
    /** How many crumbs show before the middle folds into the menu. Every one by default; a function is read live. */
    max?: Live<number> | undefined
    /** The nav's accessible name. `'Breadcrumb'` by default; a function is read live. */
    label?: Live<string> | undefined
}

/** The parts `breadcrumbs` hands back: `<nav {...crumbs.nav}>`, `<a {...crumbs.link(crumb)}>`. */
export type Breadcrumbs<Crumb> = {
    /** The nav's attributes. */
    readonly nav: Record<string, unknown>
    /** The crumbs shown, in order, an `'overflow'` standing where the middle folds. */
    get items(): readonly (Crumb | 'overflow')[]
    /** The crumbs folded into the menu, in order. */
    get folded(): readonly Crumb[]
    /** A crumb's link: its address, and `aria-current` on the page itself. */
    link(crumb: Crumb): Record<string, unknown>
    /** The folded crumbs' `menu`, its parts whole (49.18), its trigger standing where the middle folds. */
    readonly menu: Menu
    /** A folded crumb's link inside the menu: a menu item. */
    menuItem(crumb: Crumb): Record<string, unknown>
}

/** A trail of links to the page, its middle folded into a menu past `max`. */
export function breadcrumbs<Crumb>(
    options: BreadcrumbsOptions<Crumb>,
): Breadcrumbs<Crumb> {
    const trail = () => live(options.trail)
    // 51.136, 51.137 — the first, then the last `max - 1`, the rest folded between.
    const cut = (): { shown: (Crumb | 'overflow')[]; folded: Crumb[] } => {
        const all = trail()
        const most = live(options.max) ?? Number.POSITIVE_INFINITY
        if (all.length <= most || most < 2)
            return { shown: [...all], folded: [] }
        const kept = all.length - (most - 1)
        return {
            shown: [all[0] as Crumb, 'overflow', ...all.slice(kept)],
            folded: all.slice(1, kept),
        }
    }
    const folds = menu({ align: 'start' })
    return {
        // 51.140
        nav: {
            'data-breadcrumbs': 'nav',
            get 'aria-label'() {
                return live(options.label) ?? 'Breadcrumb'
            },
        },
        get items() {
            return cut().shown
        },
        get folded() {
            return cut().folded
        },
        // 51.138
        link: (crumb) => ({
            'data-breadcrumbs': 'link',
            href: options.href(crumb),
            get 'aria-current'() {
                return trail().at(-1) === crumb ? 'page' : undefined
            },
            // 49.17
            get 'data-current'() {
                return trail().at(-1) === crumb ? '' : undefined
            },
        }),
        // 51.139
        menu: folds,
        menuItem: (crumb) => ({
            role: 'menuitem',
            'data-breadcrumbs': 'item',
            href: options.href(crumb),
        }),
    }
}
