/*
Decodes HTML character references in a component's static template text to the
characters they denote, so the canonical static value is plain text both render
paths share: SSR re-escapes it into the HTML stream (the browser decodes it back),
the client builds a text node from it directly. Without this the two disagree —
SSR emits `&lt;` the browser decodes to `<`, while `createTextNode` would show the
literal `&lt;` — and the hydration split offset (raw length) misses the decoded
SSR node. Covers numeric references generally plus the named entities a template
author writes; an unknown name is left intact.
*/

const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    copy: '©',
    reg: '®',
    trade: '™',
    hellip: '…',
    mdash: '—',
    ndash: '–',
    times: '×',
    bull: '•',
    deg: '°',
}

export function decodeHtmlEntities(text: string): string {
    if (!text.includes('&')) {
        return text
    }
    return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
        if (body.charAt(0) === '#') {
            const codePoint =
                body.charAt(1).toLowerCase() === 'x'
                    ? parseInt(body.slice(2), 16)
                    : parseInt(body.slice(1), 10)
            /* A reference past the Unicode max makes String.fromCodePoint throw a
               RangeError; leave such an invalid reference intact rather than aborting compilation. */
            if (!Number.isInteger(codePoint) || codePoint > 0x10ffff) {
                return match
            }
            return String.fromCodePoint(codePoint)
        }
        return NAMED_ENTITIES[body] ?? match
    })
}
