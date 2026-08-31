// A markdown subset, rendered to HTML with no dependency. SCAFFOLDING: this exists
// only so the documentation's WORDS can be read and revised before abide can compile
// a `.abide` file. It goes when `abide build` can serve `content/` as pages.
//
// The subset is what the docs actually use: ATX headings, paragraphs, fenced code, pipe
// tables, bullet and ordered lists, blockquotes, and inline code, links, bold and italic.
// Anything outside it renders as literal text rather than silently disappearing, which is
// the behaviour that keeps a prose mistake visible.
//
// There is no `---` branch, and that is the DESIGN rule rather than an omission: the site
// carries no horizontal rules at all, so one cannot come back by accident.

const HEADING = /^(#{1,4})\s+(.*)$/
// The directive spellings. Anchored and line-at-a-time here; a caller sweeping a whole
// body takes `new RegExp(EXAMPLE.source, 'gm')` rather than writing the pattern again.
export const EXAMPLE = /^\{%\s*example\s+([\w-]+)\s*%\}$/
export const LEAD = /^\{%\s*lead\s+([\w/-]+)\s*%\}$/
const FENCE = /^```(\S*)[ \t]*(.*)$/
const BULLET = /^\s*[*-]\s+(.*)$/
const ORDERED = /^\s*\d+\.\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const TABLE_DIVIDER = /^\|(\s*:?-+:?\s*\|)+$/

export function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

// A fence's label is a file path or a one-word side. Which SIDE it names is derived
// from it rather than written twice: a `.abide` file is both sides at once, which is
// the distinction the spine colour exists to show.
// A compact highlighter: enough to make a snippet scannable, not a parser. Order in
// the alternation is the precedence — a keyword inside a string stays a string.
const TOKEN =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('[^'\n]*'|"[^"\n]*"|`[^`]*`)|(\{[#:/][a-zA-Z]*)|(<\/?[a-zA-Z][\w-]*)|\b(import|from|export|const|let|return|async|await|function|if|else|new|typeof|of|in|true|false|null|undefined)\b|\b(\d[\d_]*)\b/g

const TOKEN_CLASS = ['comment', 'string', 'block', 'tag', 'key', 'num']

export function highlight(code: string): string {
    let html = ''
    let last = 0
    TOKEN.lastIndex = 0
    for (let match = TOKEN.exec(code); match; match = TOKEN.exec(code)) {
        html += escapeHtml(code.slice(last, match.index))
        let group = 0
        for (let index = 1; index < match.length; index += 1) {
            if (match[index] !== undefined) {
                group = index
                break
            }
        }
        html += `<span class="t-${TOKEN_CLASS[group - 1]}">${escapeHtml(match[0])}</span>`
        last = match.index + match[0].length
    }
    return html + escapeHtml(code.slice(last))
}

// A file is shown by the SPECIFIER an author types, not by where it sits on disk:
// `#server/rpc/invoices.ts`, never `src/server/rpc/invoices.ts`. The two are the same
// file — the seam aliases in package.json's `imports` map `#server/*` onto `src/server/*`
// — and showing the disk form teaches a path nobody writes. Build output is untouched,
// having no seam to name.
export function displayPath(path: string): string {
    for (const seam of ['ui', 'server', 'shared']) {
        if (path.startsWith(`src/${seam}/`)) return `#${seam}/${path.slice(`src/${seam}/`.length)}`
    }
    return path
}

export function sideOf(label: string): 'server' | 'abide' | 'browser' {
    if (label.endsWith('.abide')) return 'abide'
    return label.includes('server') ? 'server' : 'browser'
}

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replaceAll('`', '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}

// Inline markup, backtick spans first so that `**` inside code stays literal.
export function renderInline(text: string): string {
    const parts = text.split('`')
    let html = ''
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? ''
        if (index % 2 === 1) {
            html += `<code>${escapeHtml(part)}</code>`
            continue
        }
        html += escapeHtml(part)
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    }
    return html
}

function renderTableRow(line: string, cell: 'td' | 'th'): string {
    const trimmed = line.replace(/^\|/, '').replace(/\|$/, '')
    let html = '<tr>'
    for (const value of trimmed.split('|'))
        html += `<${cell}>${renderInline(value.trim())}</${cell}>`
    return `${html}</tr>`
}

export function renderMarkdown(source: string): string {
    const lines = source.split('\n')
    let html = ''
    let index = 0

    while (index < lines.length) {
        const line = lines[index] ?? ''

        if (line.trim() === '') {
            index += 1
            continue
        }

        const fence = FENCE.exec(line)
        if (fence) {
            const language = fence[1] ?? ''
            const label = (fence[2] ?? '').trim()
            const body: string[] = []
            index += 1
            while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
                body.push(lines[index] ?? '')
                index += 1
            }
            index += 1 // the closing fence
            const attribute = language ? ` class="language-${escapeHtml(language)}"` : ''
            const code = `<pre><code${attribute}>${highlight(body.join('\n'))}</code></pre>`
            html += label
                ? `<figure class="snippet" data-side="${sideOf(label)}">
<figcaption>${escapeHtml(displayPath(label))}</figcaption>${code}</figure>\n`
                : `${code}\n`
            continue
        }

        const example = EXAMPLE.exec(line.trim())
        if (example) {
            html += `<!--example:${example[1]}-->\n`
            index += 1
            continue
        }

        const lead = LEAD.exec(line.trim())
        if (lead) {
            html += `<!--lead:${lead[1]}-->\n`
            index += 1
            continue
        }

        const heading = HEADING.exec(line)
        if (heading) {
            const level = (heading[1] ?? '#').length
            const text = heading[2] ?? ''
            html += `<h${level} id="${slugify(text)}">${renderInline(text)}</h${level}>\n`
            index += 1
            continue
        }

        // A table is a header row whose NEXT line is the divider — the divider is what
        // tells a table from a paragraph that happens to contain pipes.
        if (line.startsWith('|') && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
            html += `<table><thead>${renderTableRow(line, 'th')}</thead><tbody>`
            index += 2
            while (index < lines.length && (lines[index] ?? '').startsWith('|')) {
                html += renderTableRow(lines[index] ?? '', 'td')
                index += 1
            }
            html += '</tbody></table>\n'
            continue
        }

        if (QUOTE.test(line)) {
            const body: string[] = []
            while (index < lines.length) {
                const quote = QUOTE.exec(lines[index] ?? '')
                if (!quote) break
                body.push(quote[1] ?? '')
                index += 1
            }
            html += `<blockquote>${renderInline(body.join(' '))}</blockquote>\n`
            continue
        }

        const isBullet = BULLET.test(line)
        if (isBullet || ORDERED.test(line)) {
            const tag = isBullet ? 'ul' : 'ol'
            const pattern = isBullet ? BULLET : ORDERED
            const items: string[] = []
            while (index < lines.length) {
                const next = lines[index] ?? ''
                const item = pattern.exec(next)
                if (item) {
                    items.push(item[1] ?? '')
                    index += 1
                    continue
                }
                // A WRAPPED item: indented, non-blank, and not the start of another
                // block. Without this a hanging line becomes its own paragraph after
                // the list, which is how a wrapped bullet silently loses its bullet.
                const last = items.length - 1
                if (
                    last >= 0 &&
                    next.trim() !== '' &&
                    /^\s+\S/.test(next) &&
                    !FENCE.test(next.trim())
                ) {
                    items[last] += ` ${next.trim()}`
                    index += 1
                    continue
                }
                break
            }
            html += `<${tag}>`
            for (const item of items) html += `<li>${renderInline(item)}</li>`
            html += `</${tag}>\n`
            continue
        }

        const paragraph: string[] = []
        while (index < lines.length) {
            const next = lines[index] ?? ''
            if (next.trim() === '') break
            if (HEADING.test(next) || FENCE.test(next) || BULLET.test(next)) break
            if (EXAMPLE.test(next.trim()) || LEAD.test(next.trim())) break
            if (ORDERED.test(next) || QUOTE.test(next) || next.startsWith('|')) break
            paragraph.push(next)
            index += 1
        }
        html += `<p>${renderInline(paragraph.join(' '))}</p>\n`
    }

    return html
}
