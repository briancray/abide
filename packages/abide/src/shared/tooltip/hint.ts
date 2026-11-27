// 50.86, 50.87 — A HINT'S TEXT IS MARKDOWN: rendered for the host to show, and read as plain text for
// what describes its anchor, so a screen reader hears no `**` or `#`.

import { markdown } from '../markdown/markdown.ts'

// 50.47 — a hint is never the pointer's target, so a link in one is its text; and a heading in one
// is the deepest, never outranking the page's own.
const HINT = { href: () => undefined, headingLevel: 6 }

/** A hint's text rendered as HTML, to hand to `raw`. */
export function hintHtml(text: string): string {
    return markdown(text, HINT)
}

// A line break, or the end of a block, a list item or a table row: where the plain text takes a new line.
const BREAK = /<br>|<hr>|<\/(?:p|h[1-6]|li|tr|blockquote|pre)>/g
// A table cell's end, where the plain text takes a space.
const CELL = /<\/t[dh]>/g
const TAG = /<[^>]*>/g
// The only references `markdown` writes: its escapes.
const REFERENCE = /&(amp|lt|gt|quot);/g
const CHARACTERS: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
}

/** A hint's text as a reader hears it, from its `hintHtml`: every mark gone. */
export function hintText(html: string): string {
    return html
        .replace(BREAK, '\n')
        .replace(CELL, ' ')
        .replace(TAG, '')
        .replace(REFERENCE, (_, name: string) => CHARACTERS[name] as string)
        .replace(/[ \t]*\n\s*/g, '\n')
        .trim()
}
