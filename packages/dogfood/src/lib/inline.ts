import { markdown, type RouteLiteral, url } from '@abide/abide'

/** A path on the site written below its mount (16.10); any other address as it is. */
export function siteHref(address: string): string {
    return address.startsWith('/') ? url(address as RouteLiteral) : address
}

/**
 * One line of the site's own words — a title, an intent, a lead, a card's caption — as HTML: the
 * inline marks of `markdown`, with a link to a route written through `url`.
 */
export function inline(text: string): string {
    return markdown(text, { inline: true, href: siteHref })
}

/** A heading's anchor: its words, lowercased, with everything else a single dash. */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replaceAll('`', '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}
