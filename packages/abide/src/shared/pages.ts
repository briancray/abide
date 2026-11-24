// 51.125-51.129 — A RUN OF PAGE NUMBERS: the first, the last and the ones around the page on, the
// rest folded into gaps, with a link per page and one to the page before and after, as parts an app
// spreads onto a nav, links or buttons of its own. Given `href`, each is a link to its page's
// address, so it works before the page hydrates; without, a button that writes `page`.

import { handFocus } from './handFocus.ts'
import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'

/** How many pages there are, the one on, and where each lives. */
export type PagesOptions = {
    /** How many pages there are; a function is read live. */
    count: Live<number>
    /** The page on, from `1`: a `Reactive` to read and set. Held by the parts, and handed back as `page`, where none is given. */
    page?: Reactive<number>
    /** How many pages either side of the page on are listed. `1` by default; a function is read live. */
    around?: Live<number>
    /** The address of a page, making each part a link to it rather than a button. */
    href?: (page: number) => string
    /** The nav's accessible name. `'Pages'` by default; a function is read live. */
    label?: Live<string>
}

/** The parts `pages` hands back: `<nav {...list.nav}>`, `<a {...list.link(n)}>`. */
export type Pages = {
    /** The nav's attributes. */
    readonly nav: Record<string, unknown>
    /** The pages listed in order, a `'gap'` standing where pages between two of them are left out. */
    get items(): readonly (number | 'gap')[]
    /** A page's link: to its address, or a button that turns to it. */
    link(page: number): Record<string, unknown>
    /** The link to the page before, disabled on the first. */
    readonly previous: Record<string, unknown>
    /** The link to the page after, disabled on the last. */
    readonly next: Record<string, unknown>
    /** The page on; written, it turns to that page. */
    readonly page: Reactive<number>
}

/** Pagination over `count` pages, as parts to spread. */
export function pages(options: PagesOptions): Pages {
    const page = options.page ?? reactive(1)
    const count = () => Math.max(1, live(options.count))
    const on = () => Math.min(Math.max(1, page()), count())
    const { href } = options

    // 51.125 — a gap that would stand for one page is that page.
    const items = (): (number | 'gap')[] => {
        const last = count()
        const near = live(options.around) ?? 1
        const listed: (number | 'gap')[] = []
        let previous = 0
        for (let at = 1; at <= last; at += 1) {
            if (at !== 1 && at !== last && Math.abs(at - on()) > near) continue
            if (at - previous === 2) listed.push(at - 1)
            else if (at - previous > 2) listed.push('gap')
            listed.push(at)
            previous = at
        }
        return listed
    }

    // 51.126 — a link to its address where `href` is given, else a button; either writes `page`.
    const go = (to: () => number, part: string): Record<string, unknown> => {
        const disabled = () => to() < 1 || to() > count() || to() === on()
        return href === undefined
            ? {
                  type: 'button',
                  'data-pages': part,
                  get disabled() {
                      return part !== 'page' && disabled()
                  },
                  onclick: (event?: MouseEvent) => {
                      if (disabled()) return
                      page.set(to())
                      handOn(event, part)
                  },
              }
            : {
                  'data-pages': part,
                  get href() {
                      return part !== 'page' && disabled()
                          ? undefined
                          : href(to())
                  },
                  get 'aria-disabled'() {
                      return part !== 'page' && disabled() ? 'true' : undefined
                  },
                  onclick: (event?: MouseEvent) => {
                      if (disabled()) return
                      page.set(to())
                      handOn(event, part)
                  },
              }
    }

    // 49.15 — `previous` or `next` stepping to its end hands focus to the other.
    const handOn = (event: MouseEvent | undefined, part: string): void => {
        if (part === 'page') return
        const pressed = event?.currentTarget as HTMLElement | null | undefined
        const atEnd = part === 'next' ? on() >= count() : on() <= 1
        handFocus(pressed, atEnd, () =>
            pressed
                ?.closest('[data-pages="nav"]')
                ?.querySelector<HTMLElement>(
                    `[data-pages="${part === 'next' ? 'previous' : 'next'}"]`,
                ),
        )
    }
    const links = new Map<number, Record<string, unknown>>()
    const link = (at: number): Record<string, unknown> => {
        let made = links.get(at)
        if (made === undefined) {
            made = go(() => at, 'page')
            // 51.127
            Object.defineProperty(made, 'aria-current', {
                enumerable: true,
                get: () => (on() === at ? 'page' : undefined),
            })
            links.set(at, made)
        }
        return made
    }

    return {
        // 51.129
        nav: {
            'data-pages': 'nav',
            get 'aria-label'() {
                return live(options.label) ?? 'Pages'
            },
        },
        get items() {
            return items()
        },
        link,
        // 51.128
        previous: go(() => on() - 1, 'previous'),
        next: go(() => on() + 1, 'next'),
        page,
    }
}
