import { markdown } from '@abide/abide'

import type { Heading } from '#src/lib/Heading.ts'
import { inline, siteHref, slugify } from '#src/lib/inline.ts'

import { CLAUSE } from './CLAUSE.ts'

// RULEBOOK.md AS A PAGE, read off the file rather than copied into one, so a renumber is a rebuild
// and never an edit here. A clause and a group are anchored by their own number — `#41.10`, `#41` —
// which is the address an editor or a citation links to.
//
// The clause match is `CLAUSE`, shared with `rulebookClauses.ts`, the reading the
// citation gates use. The paragraph split is not, and `tests/rulebookPage.test.ts` holds the two to
// the same ids: a page also breaks before a heading that opens with no blank line above it.

const GROUP = /^# (\d+)\.\s+(.*)$/

// A clause hangs its number in the gutter, and the one an address points at is washed.
const CLAUSE_CLASS =
    'relative -mx-2 scroll-mt-[calc(var(--spacing-bar)+1.5rem)] rounded-sm py-1 pr-2 pl-16 target:bg-signal/8'
const NUMBER_CLASS =
    'absolute top-1 left-2 font-mono text-chrome/6 text-muted no-underline hover:text-signal'

/** The rulebook's opening line and every heading the rail lists, as `Doc` inlines them, and its body as HTML. */
export function rulebookOf(rulebook: string): {
    summary: string
    html: string
    headings: Heading[]
} {
    const headings: Heading[] = []
    let summary = ''
    let html = ''
    // A heading is a block of its own even where no blank line sets it off, as markdown reads it.
    for (const block of rulebook.split(/\n\s*\n|\n(?=#{1,2} )/)) {
        const paragraph = block.trim()
        if (paragraph === '' || paragraph.startsWith('# Rulebook')) continue
        const clause = CLAUSE.exec(paragraph)
        if (clause) {
            const id = clause[1] ?? ''
            html += `<p class="${CLAUSE_CLASS}" id="${id}"><a class="${NUMBER_CLASS}" href="#${id}">${id}</a>${inline((clause[2] ?? '').replace(/\n/g, ' '))}</p>`
            continue
        }
        const group = GROUP.exec(paragraph)
        if (group) {
            const id = group[1] ?? ''
            const title = `${id}. ${group[2] ?? ''}`
            headings.push({ id, title, level: 2 })
            html += `<h2 class="mt-9" id="${id}">${inline(title)}</h2>`
            continue
        }
        if (paragraph.startsWith('## ')) {
            const title = paragraph.slice(3)
            headings.push({ id: slugify(title), title, level: 2 })
            html += `<h2 id="${slugify(title)}">${inline(title)}</h2>`
            continue
        }
        // A table, a numbered list or a paragraph: markdown's own, with each line's break a space.
        const text = paragraph.startsWith('|')
            ? paragraph
            : paragraph.replace(/\n(?!\d+\.\s|- )\s*/g, ' ')
        if (summary === '') summary = text
        else html += markdown(text, { href: siteHref })
    }
    return { summary, html, headings }
}
