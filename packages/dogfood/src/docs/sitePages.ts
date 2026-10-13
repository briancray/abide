import { SITE, type SitePage } from './SITE.ts'

// THE SITE MAP READ BY ROUTE, walked once: every page in reading order, and the section each is in.
const ORDER: SitePage[] = []
const SECTION_OF = new Map<string, string>()
for (const group of SITE)
    for (const page of group.pages) {
        ORDER.push(page)
        SECTION_OF.set(page.route, group.section)
    }

/** The page at `route`, which every docs page is — a route `SITE` does not list throws. */
export function pageAt(route: string): SitePage {
    for (const page of ORDER) if (page.route === route) return page
    throw new Error(`docs: ${route} is not in SITE`)
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
