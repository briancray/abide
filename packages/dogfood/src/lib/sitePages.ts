import { REFERENCE } from './REFERENCE.ts'
import { SITE, type SitePage } from './SITE.ts'

// An export's page is titled with its names and opens on the line that imports them; a group's page
// holds what that part of the registry writes in place rather than imports.
function referencePageOf(page: (typeof REFERENCE)[number]): SitePage {
    if (page.entry === undefined)
        return {
            route: page.route,
            title: page.group,
            nav: page.group,
            intent: '',
            lead: `${page.group}: what is written in place rather than imported.`,
        }
    const names = page.names.map((name) => `\`${name}\``).join(' / ')
    return {
        route: page.route,
        title: names,
        nav: names,
        intent: '',
        lead: `\`import ${page.typeOnly ? 'type ' : ''}{ ${page.names.join(', ')} } from '${page.entry}'\``,
    }
}

/**
 * Every section in reading order: `SITE`'s, with the reference's generated pages after its overview
 * (40.42) — what the nav, the gates and the markdown bundle walk.
 */
export const SECTIONS: readonly {
    section: string
    pages: readonly SitePage[]
}[] = SITE.map((group) =>
    group.section === 'Reference'
        ? {
              ...group,
              pages: [...group.pages, ...REFERENCE.map(referencePageOf)],
          }
        : group,
)

// THE SITE MAP READ BY ROUTE, walked once: every page in reading order, and the section each is in.
const ORDER: SitePage[] = []
const SECTION_OF = new Map<string, string>()
for (const group of SECTIONS)
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
