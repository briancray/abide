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
// `{% snippet <example> <file> [anchor] %}`. The anchor runs to the closing `%}` because
// it is a line of CODE and code has spaces in it; no anchor means the whole file.
export const SNIPPET = /^\{%\s*snippet\s+([\w-]+)\s+(\S+)(?:\s+(.*?))?\s*%\}$/
const FENCE = /^```(\S*)[ \t]*(.*)$/
const BULLET = /^\s*[*-]\s+(.*)$/
const ORDERED = /^\s*\d+\.\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const TIP = /^\[!TIP\]\s*/
const TABLE_DIVIDER = /^\|(\s*:?-+:?\s*\|)+$/

export function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
}

// A fence's label is a file path or one of four words — `server`, `browser`, `shared`,
// `abide`. Which SIDE it names is derived from it rather than written twice. Four words
// and three colours: `shared` and `abide` are both sides at once, which is the
// distinction the spine exists to show, and the seam is what decides it rather than the
// extension — a `#shared/*.ts` is as much both sides as a `.abide` file is.
export const EXCERPT = / — excerpt$/

// A SIDE IS NOT A SYNTAX, and the caption used to show only the side: a block labelled
// `browser` told a reader where the code runs and left them to guess whether they were looking
// at the sugar or at what it is spelled over. Those are the two forms this design is ABOUT — a
// name read by name in a `.abide` file, and `s()` in a `.ts` one — so the one thing a caption
// has to say is which of them is on screen.
//
// DERIVED from the fence's own language rather than written into the label, because the label
// already carries it: seventy-one fences say `browser` or `shared`, and every one of them is
// already tagged `ts` or `abide` a token earlier. A path says both by itself and is left alone.
export function captionOf(language: string, label: string): string {
    if (label.includes('/') || label.startsWith('#')) return displayPath(label)
    if (!language || language === label) return `.${label}`
    return `.${language} · ${label}`
}

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
    const suffix = EXCERPT.test(path) ? ' — excerpt' : ''
    const address = path.replace(EXCERPT, '')
    for (const seam of ['ui', 'server', 'shared']) {
        if (address.startsWith(`src/${seam}/`))
            return `#${seam}/${address.slice(`src/${seam}/`.length)}${suffix}`
    }
    return path
}

// The spine has three values and the seams have three names, and they do not line up
// one to one: `#shared` and a `.abide` file are BOTH SIDES, so they take the same colour.
// `— excerpt` is a suffix on the caption, never part of the address, so it is stripped
// before the seam is read.
export function sideOf(label: string): 'server' | 'abide' | 'browser' {
    const address = label.replace(EXCERPT, '')
    if (address.endsWith('.abide') || address === 'abide') return 'abide'
    if (address.startsWith('#shared/') || address.startsWith('src/shared/') || address === 'shared')
        return 'abide'
    if (address.startsWith('#server/') || address.startsWith('src/server/') || address === 'server')
        return 'server'
    return 'browser'
}

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replaceAll('`', '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}

// A code span is LIFTED OUT before emphasis runs and put back after, which is what makes
// `**\`initial\`**` one span rather than three. Emphasis used to run per backtick SEGMENT, so
// a `**` on one side of a code span and its partner on the other were never in the same
// string: neither matched, the single-`*` rule then ate one of them, and the page shipped
// its asterisks. Nothing reported it — the markdown download was right the whole time.
//
// A slot is NUL-delimited because the text it sits in is already HTML-escaped, so the one
// thing that cannot appear around it is a control character.
const CODE_SLOT = /\0(\d+)\0/g

export function renderInline(text: string): string {
    const parts = text.split('`')
    const codes: string[] = []
    let markup = ''
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? ''
        if (index % 2 === 1) {
            markup += `\0${codes.length}\0`
            codes.push(`<code>${escapeHtml(part)}</code>`)
            continue
        }
        markup += escapeHtml(part)
    }
    return markup
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(CODE_SLOT, (_, slot) => codes[Number(slot)] ?? '')
}

// A cell opening on `yes` / `no` is a VERDICT and its REASON — the answer is what the
// column is scanned for and the reason is why, and undifferentiated they read as one wall
// of prose. The verdict has to END there: `no route matched, or no handler is mounted` is
// a sentence that begins with the word, so the tell is what FOLLOWS — end of cell,
// punctuation, or the em dash the reason is introduced with.
const VERDICT = /^(yes|no)(?=$|[,;.]|\s+—)(.*)$/

function renderCell(value: string, cell: 'td' | 'th'): string {
    const verdict = cell === 'td' ? VERDICT.exec(value) : null
    if (!verdict?.[1]) return `<${cell}>${renderInline(value)}</${cell}>`
    const why = verdict[2] ?? ''
    const reason = why ? `<span class="verdict-why">${renderInline(why)}</span>` : ''
    return `<${cell}><b class="verdict-${verdict[1]}">${verdict[1]}</b>${reason}</${cell}>`
}

// A `\|` is a pipe INSIDE a cell and never a cell boundary, which is the only way to write a
// union type in a table — and splitting on every pipe broke the row into extra cells and left the
// backslash sitting in the output. Silent in the usual way: the table still rendered, with
// `() => void \` in one cell and `Disposer` in the next, and the row after it shunted right.
function renderTableRow(line: string, cell: 'td' | 'th'): string {
    const trimmed = line.replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
    let html = '<tr>'
    for (const value of trimmed.split(/(?<!\\)\|/))
        html += renderCell(value.trim().replaceAll('\\|', '|'), cell)
    return `${html}</tr>`
}

// THE BOXES THE GAPS HANG ON. A markdown body is a FLAT stream of blocks and the page's
// spacing is three nested flex columns — region, section, prose — so the boxes have to be
// folded back in somewhere. Here, off the headings, which are the only structure the source
// states. Run this AFTER the directives expand: a lead brings its own headings with it.
//
// A heading always begins a line of the rendered stream, which is what makes this a scan
// rather than a parse — a `<h2` inside a code block is `&lt;h2` by the time it lands.
const SECTION_HEADING = /^<h([23]) id="/gm

function flow(blocks: string): string {
    return blocks.trim() ? `<div class="flow">${blocks}</div>` : ''
}

export function groupSections(html: string): string {
    const headings: { depth: number; at: number }[] = []
    SECTION_HEADING.lastIndex = 0
    for (let match = SECTION_HEADING.exec(html); match; match = SECTION_HEADING.exec(html))
        headings.push({ depth: Number(match[1]) - 1, at: match.index })
    if (headings.length === 0) return flow(html)

    let grouped = flow(html.slice(0, headings[0]?.at))
    let open = 0
    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index]
        if (!heading) continue
        // An h2 closes every section standing; an h3 closes only another h3.
        while (open >= heading.depth) {
            grouped += '</section>'
            open -= 1
        }
        grouped += '<section>'
        open += 1
        grouped += flow(html.slice(heading.at, headings[index + 1]?.at ?? html.length))
    }
    return grouped + '</section>'.repeat(open)
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
<figcaption>${escapeHtml(captionOf(language, label))}</figcaption>${code}</figure>\n`
                : `${code}\n`
            continue
        }

        const example = EXAMPLE.exec(line.trim())
        if (example) {
            html += `<!--example:${example[1]}-->\n`
            index += 1
            continue
        }

        const snippet = SNIPPET.exec(line.trim())
        if (snippet) {
            // JSON rather than a delimiter, because an anchor is arbitrary source and
            // every separator worth typing occurs in some line of it.
            const address = {
                example: snippet[1] ?? '',
                file: snippet[2] ?? '',
                anchor: snippet[3] ?? '',
            }
            html += `<!--snippet:${JSON.stringify(address)}-->\n`
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
            // `> [!TIP]` on the opening line makes the quote a TIP — the same component
            // a result frame annotates a render with, so the documentation speaks in one
            // voice whether it is talking beside a page or inside one. A quote without it
            // stays a quote: that one is someone ELSE talking.
            const first = body[0] ?? ''
            if (TIP.test(first)) {
                body[0] = first.replace(TIP, '')
                html += `<aside class="tip">${renderInline(body.join(' ').trim())}</aside>\n`
                continue
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
