import { escapeAttribute, type RouteLiteral, url } from '@abide/abide'

// A slot is NUL-delimited because the text it sits in is already escaped, so the one thing that
// cannot appear around it is a control character.
const CODE_SLOT = /\0(\d+)\0/g

/**
 * One line of the site's own words — a title, an intent, a lead, a card's caption — as HTML: code
 * spans, links, bold and italic, the four marks the words in `SITE` use.
 *
 * A code span is LIFTED OUT before emphasis runs and put back after, which is what makes
 * `**\`initial\`**` one span rather than three. A link to a route is written through `url`, so it is
 * right below a mount (16.10).
 */
export function inline(text: string): string {
    const parts = text.split('`')
    const codes: string[] = []
    let markup = ''
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? ''
        if (index % 2 === 1) {
            markup += `\0${codes.length}\0`
            codes.push(`<code>${escapeAttribute(part)}</code>`)
            continue
        }
        markup += escapeAttribute(part)
    }
    return markup
        .replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            (_whole, label: string, href: string) =>
                `<a href="${href.startsWith('/') ? url(href as RouteLiteral) : href}">${label}</a>`,
        )
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(CODE_SLOT, (_whole, slot: string) => codes[Number(slot)] ?? '')
}

/** A heading's anchor: its words, lowercased, with everything else a single dash. */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replaceAll('`', '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}
