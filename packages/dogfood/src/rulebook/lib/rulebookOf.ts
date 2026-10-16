import { inline, slugify } from '#src/lib/inline.ts'

// RULEBOOK.md AS A PAGE, read off the file rather than copied into one, so a renumber is a rebuild
// and never an edit here. A clause and a group are anchored by their own number — `#41.10`, `#41` —
// which is the address an editor or a citation links to.
//
// The paragraph split and the clause match are `dogfood/scripts/rulebookClauses.ts`'s, the reading
// the citation gates use; `tests/rulebookPage.test.ts` holds the two to the same ids.

const CLAUSE = /^(\d+\.\d+)\s+([\s\S]*)$/
const GROUP = /^# (\d+)\.\s+(.*)$/

// A clause hangs its number in the gutter, and the one an address points at is washed.
const CLAUSE_CLASS =
    'relative -mx-2 scroll-mt-[calc(var(--spacing-bar)+1.5rem)] rounded-sm py-1 pr-2 pl-16 target:bg-signal/8'
const NUMBER_CLASS =
    'absolute top-1 left-2 font-mono text-chrome/6 text-muted no-underline hover:text-signal'

function row(line: string): string[] {
    return line
        .replace(/^\||\|$/g, '')
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim().replaceAll('\\|', '|'))
}

function table(lines: string[]): string {
    let head = ''
    for (const cell of row(lines[0] ?? '')) head += `<th>${inline(cell)}</th>`
    let body = ''
    for (const line of lines.slice(2)) {
        body += '<tr>'
        for (const cell of row(line)) body += `<td>${inline(cell)}</td>`
        body += '</tr>'
    }
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

function orderedList(paragraph: string): string {
    let items = ''
    for (const item of paragraph.split(/\n(?=\d+\.\s)/))
        items += `<li>${inline(item.replace(/^\d+\.\s+/, '').replace(/\s*\n\s*/g, ' '))}</li>`
    return `<ol>${items}</ol>`
}

/** The rulebook's opening line, its body, and every heading the rail lists — all as HTML. */
export function rulebookOf(markdown: string): {
    summary: string
    html: string
    headings: { id: string; title: string }[]
} {
    const headings: { id: string; title: string }[] = []
    let summary = ''
    let html = ''
    // A heading is a block of its own even where no blank line sets it off, as markdown reads it.
    for (const block of markdown.split(/\n\s*\n|\n(?=#{1,2} )/)) {
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
            headings.push({ id, title: inline(title) })
            html += `<h2 class="mt-9" id="${id}">${inline(title)}</h2>`
            continue
        }
        if (paragraph.startsWith('## ')) {
            const title = paragraph.slice(3)
            headings.push({ id: slugify(title), title: inline(title) })
            html += `<h2 id="${slugify(title)}">${inline(title)}</h2>`
            continue
        }
        if (paragraph.startsWith('|')) {
            html += table(paragraph.split('\n'))
            continue
        }
        if (/^\d+\.\s/.test(paragraph)) {
            html += orderedList(paragraph)
            continue
        }
        const text = inline(paragraph.replace(/\n/g, ' '))
        if (summary === '') summary = text
        else html += `<p>${text}</p>`
    }
    return { summary, html, headings }
}
