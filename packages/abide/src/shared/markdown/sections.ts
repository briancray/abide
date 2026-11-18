// MARKDOWN AS HTML THAT IS SAFE BY CONSTRUCTION: every character of the source reaches the output
// escaped, and the only markup is what this file writes — so raw HTML in the source is text (52.8),
// a link keeps an address only on a scheme the caller allows (52.9), and an image is a link to it
// rather than a request for it (52.10).
//
// The source renders as SECTIONS, each starting on a line that opens a fresh block after a blank
// one, and a section renders the same alone as inside the whole. That is what lets a stream render
// only the section still growing (`Markdown.abide`, 52.18), and a source cut anywhere — an open
// fence, an open emphasis — renders what it has, with the next chunk rendering the whole (52.12).
//
// NOT `safeUrl`: that is the template's check over one fixed set, `data:` in it, where a link here
// is checked against the schemes its caller names.

import { escapeAttribute as escape } from '../escapeText.ts'

/** The settings a render runs under, defaults filled in. */
export type Settings = {
    schemes: readonly string[]
    headingLevel: number
    href: ((address: string) => string | undefined) | undefined
}

export const SCHEMES: readonly string[] = ['http', 'https', 'mailto']

/** The address a link to `url` is written with, or `undefined` where it is written as its text. */
function addressOf(url: string, settings: Settings): string | undefined {
    if (!allowed(url, settings.schemes)) return undefined
    return settings.href === undefined ? url : settings.href(url)
}

/** Whether `url` may be a link's address: a scheme in `schemes`, or a path on this origin. */
function allowed(url: string, schemes: readonly string[]): boolean {
    // A browser drops control characters and whitespace before it reads the scheme.
    if (/[\u0000- \u007f]/.test(url)) return false
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)?.[1]
    if (scheme !== undefined) return schemes.includes(scheme.toLowerCase())
    // `//host` and its backslash spellings leave the origin on the page's own scheme.
    if (/^[/\\]{2}/.test(url))
        return schemes.includes('https') && schemes.includes('http')
    return true
}

const FENCE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:( +)(.*))?$/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?/
const TABLE_DELIMITER =
    /^ {0,3}\|?(?: *:?-+:? *\|)+(?: *:?-+:? *)?$|^ {0,3}\|? *:?-+:? *\|(?: *:?-+:? *\|?)*$/

type Fence = { marker: string; length: number; info: string }

function fenceOf(line: string): Fence | undefined {
    const match = FENCE.exec(line)
    if (!match?.[1]) return undefined
    const marker = match[1]
    if (marker[0] === '~' && (match[2] ?? '').includes('~')) return undefined
    return {
        marker: marker[0] as string,
        length: marker.length,
        info: (match[2] ?? '').trim(),
    }
}

function closes(line: string, fence: Fence): boolean {
    const run = FENCE_CLOSE.exec(line)?.[1]
    return (
        run !== undefined &&
        run[0] === fence.marker &&
        run.length >= fence.length
    )
}

function blank(line: string): boolean {
    return line.trim() === ''
}

/**
 * The offset the section starting at `from` ends at: the start of the next line that opens a
 * section, or the end of `text`. A line opens one where it follows a blank line outside a fence,
 * starts unindented, and is not a list item — and a line still being written opens one only where
 * its first character already rules a list item out.
 */
export function sectionEnd(text: string, from: number): number {
    let fence: Fence | undefined
    let afterBlank = false
    let at = from
    while (at < text.length) {
        const newline = text.indexOf('\n', at)
        const complete = newline !== -1
        const line = text
            .slice(at, complete ? newline : text.length)
            .replace(/\r$/, '')
        if (
            at > from &&
            afterBlank &&
            fence === undefined &&
            !blank(line) &&
            (complete ? !LIST_ITEM.test(line) : !/^[\d*+-]/.test(line)) &&
            line[0] !== ' ' &&
            line[0] !== '\t'
        )
            return at
        if (!complete) return text.length
        if (fence !== undefined) {
            if (closes(line, fence)) fence = undefined
        } else fence = fenceOf(line)
        afterBlank = fence === undefined && blank(line)
        at = newline + 1
    }
    return text.length
}

/** `text`'s sections, from its first, as HTML: what `markdown` renders. */
export function render(text: string, settings: Settings): string {
    let html = ''
    let at = 0
    while (at < text.length) {
        const end = sectionEnd(text, at)
        html += renderSection(text.slice(at, end), settings)
        at = end
    }
    return html
}

/** One section's HTML. */
export function renderSection(section: string, settings: Settings): string {
    const lines = section.split('\n')
    for (let index = 0; index < lines.length; index += 1)
        lines[index] = expandIndent((lines[index] as string).replace(/\r$/, ''))
    return blocks(lines, settings, false)
}

/** `line` with the tabs of its indent as four spaces each. */
function expandIndent(line: string): string {
    if (!line.startsWith('\t') && !line.startsWith(' \t')) return line
    const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
    return indent.replaceAll('\t', '    ') + line.slice(indent.length)
}

function indentOf(line: string): number {
    return /^ */.exec(line)?.[0].length ?? 0
}

/** Whether `line` ends a paragraph above it without a blank line. */
function interrupts(line: string): boolean {
    if (
        fenceOf(line) ||
        HEADING.test(line) ||
        RULE.test(line) ||
        QUOTE.test(line)
    )
        return true
    const item = LIST_ITEM.exec(line)
    if (!item || item[4] === undefined || item[4] === '') return false
    return !/^\d/.test(item[2] ?? '') || /^1[.)]$/.test(item[2] ?? '')
}

function blocks(
    lines: readonly string[],
    settings: Settings,
    tight: boolean,
): string {
    let html = ''
    let index = 0
    while (index < lines.length) {
        const line = lines[index] as string
        if (blank(line)) {
            index += 1
            continue
        }
        const fence = fenceOf(line)
        if (fence) {
            const code: string[] = []
            index += 1
            while (
                index < lines.length &&
                !closes(lines[index] as string, fence)
            ) {
                code.push(lines[index] as string)
                index += 1
            }
            index += 1
            const language = fence.info.split(/\s/)[0] ?? ''
            html += `<pre><code${language === '' ? '' : ` data-language="${escape(language)}"`}>${escape(code.join('\n'))}</code></pre>`
            continue
        }
        const heading = HEADING.exec(line)
        if (heading) {
            const level = Math.min(
                6,
                settings.headingLevel - 1 + (heading[1] as string).length,
            )
            html += `<h${level}>${inline(heading[2] ?? '', settings, false)}</h${level}>`
            index += 1
            continue
        }
        if (RULE.test(line)) {
            html += '<hr>'
            index += 1
            continue
        }
        if (QUOTE.test(line)) {
            const quoted: string[] = []
            while (index < lines.length && QUOTE.test(lines[index] as string)) {
                quoted.push((lines[index] as string).replace(QUOTE, ''))
                index += 1
            }
            html += `<blockquote>${blocks(quoted, settings, false)}</blockquote>`
            continue
        }
        if (LIST_ITEM.test(line)) {
            const listed = list(lines, index, settings)
            html += listed.html
            index = listed.next
            continue
        }
        const next = lines[index + 1]
        if (
            line.includes('|') &&
            next !== undefined &&
            TABLE_DELIMITER.test(next)
        ) {
            const tabled = table(lines, index, settings)
            if (tabled) {
                html += tabled.html
                index = tabled.next
                continue
            }
        }
        const paragraph: string[] = [inline(line.trim(), settings, false)]
        index += 1
        while (
            index < lines.length &&
            !blank(lines[index] as string) &&
            !interrupts(lines[index] as string)
        ) {
            paragraph.push(
                inline((lines[index] as string).trim(), settings, false),
            )
            index += 1
        }
        const text = paragraph.join('<br>')
        html += tight ? text : `<p>${text}</p>`
    }
    return html
}

/** Whether two list markers belong to one list: the same bullet, or the same number delimiter. */
function sameList(marker: string, other: string): boolean {
    const ordered = /^\d/.test(marker)
    if (ordered !== /^\d/.test(other)) return false
    return ordered ? marker.at(-1) === other.at(-1) : marker === other
}

function list(
    lines: readonly string[],
    start: number,
    settings: Settings,
): { html: string; next: number } {
    const opening = LIST_ITEM.exec(lines[start] as string) as RegExpExecArray
    const marker = opening[2] as string
    const ordered = /^\d/.test(marker)
    const items: string[][] = []
    let loose = false
    let index = start
    while (index < lines.length) {
        const line = lines[index] as string
        const item = LIST_ITEM.exec(line)
        if (!item || RULE.test(line) || !sameList(marker, item[2] as string))
            break
        const markerIndent = (item[1] as string).length
        const spaces = (item[3] ?? ' ').length
        const contentIndent =
            markerIndent +
            (item[2] as string).length +
            (spaces > 4 ? 1 : spaces)
        const content: string[] = [item[4] ?? '']
        index += 1
        while (index < lines.length) {
            const next = lines[index] as string
            if (blank(next)) {
                content.push('')
                index += 1
                continue
            }
            const indent = indentOf(next)
            if (indent >= contentIndent) {
                content.push(next.slice(contentIndent))
                index += 1
                continue
            }
            // A list nested two spaces in, short of where the item's text starts.
            if (indent >= markerIndent + 2 && LIST_ITEM.test(next)) {
                content.push(next.slice(markerIndent + 2))
                index += 1
                continue
            }
            if (
                content.at(-1) === '' ||
                LIST_ITEM.test(next) ||
                interrupts(next)
            )
                break
            content.push(next.trim())
            index += 1
        }
        let trailing = 0
        while (content.length > 1 && content.at(-1) === '') {
            content.pop()
            trailing += 1
        }
        if (content.includes('')) loose = true
        const following = lines[index]
        if (trailing > 0 && following !== undefined) {
            const sibling = LIST_ITEM.exec(following)
            if (sibling && sameList(marker, sibling[2] as string)) loose = true
        }
        items.push(content)
    }
    const tag = ordered ? 'ol' : 'ul'
    const first = Number.parseInt(marker, 10)
    let html = ordered && first !== 1 ? `<ol start="${first}">` : `<${tag}>`
    for (const content of items)
        html += `<li>${blocks(content, settings, !loose)}</li>`
    return { html: `${html}</${tag}>`, next: index }
}

/** A row's cells, split on the pipes no backslash escapes. */
function cellsOf(line: string): string[] {
    let row = line.trim()
    if (row.startsWith('|')) row = row.slice(1)
    if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
    const cells: string[] = []
    let cell = ''
    for (let at = 0; at < row.length; at += 1) {
        const character = row[at] as string
        if (character === '\\' && row[at + 1] === '|') {
            cell += '|'
            at += 1
        } else if (character === '|') {
            cells.push(cell.trim())
            cell = ''
        } else cell += character
    }
    cells.push(cell.trim())
    return cells
}

function table(
    lines: readonly string[],
    start: number,
    settings: Settings,
): { html: string; next: number } | undefined {
    const header = cellsOf(lines[start] as string)
    const delimiters = cellsOf(lines[start + 1] as string)
    if (header.length !== delimiters.length) return undefined
    const aligns: string[] = []
    for (const delimiter of delimiters)
        aligns.push(
            delimiter.startsWith(':') && delimiter.endsWith(':')
                ? ' data-align="center"'
                : delimiter.endsWith(':')
                  ? ' data-align="right"'
                  : delimiter.startsWith(':')
                    ? ' data-align="left"'
                    : '',
        )
    let html = '<table><thead><tr>'
    for (let column = 0; column < header.length; column += 1)
        html += `<th${aligns[column]}>${inline(header[column] as string, settings, false)}</th>`
    html += '</tr></thead><tbody>'
    let index = start + 2
    while (index < lines.length) {
        const line = lines[index] as string
        if (blank(line) || interrupts(line)) break
        const cells = cellsOf(line)
        html += '<tr>'
        for (let column = 0; column < header.length; column += 1)
            html += `<td${aligns[column]}>${inline(cells[column] ?? '', settings, false)}</td>`
        html += '</tr>'
        index += 1
    }
    return { html: `${html}</tbody></table>`, next: index }
}

const SPECIAL = /[\\`*_~[!<h]/g
const PUNCTUATION = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u

/** One line of text's inline markup. `linked` is whether it is already inside a link. */
export function inline(
    text: string,
    settings: Settings,
    linked: boolean,
): string {
    let html = ''
    let plain = 0
    // The delimiter runs found to have no closer, which no later opener of the run can find either.
    const unclosed = new Set<string>()
    SPECIAL.lastIndex = 0
    let at = 0
    while (at < text.length) {
        SPECIAL.lastIndex = at
        const found = SPECIAL.exec(text)
        if (!found) break
        at = found.index
        const character = text[at] as string
        let written: string | undefined
        let end = at
        if (character === '\\') {
            const next = text[at + 1]
            if (next !== undefined && PUNCTUATION.test(next)) {
                written = escape(next)
                end = at + 2
            }
        } else if (character === '`') {
            const run = runOf(text, at)
            const close = unclosed.has(`\`${run}`)
                ? -1
                : closingTicks(text, at + run, run)
            if (close === -1) {
                unclosed.add(`\`${run}`)
                written = '`'.repeat(run)
            } else {
                let code = text.slice(at + run, close)
                if (
                    code.length > 2 &&
                    code.startsWith(' ') &&
                    code.endsWith(' ') &&
                    code.trim() !== ''
                )
                    code = code.slice(1, -1)
                written = `<code>${escape(code)}</code>`
            }
            end = close === -1 ? at + run : close + run
        } else if (
            character === '*' ||
            character === '_' ||
            character === '~'
        ) {
            const emphasis = emphasisAt(text, at, settings, linked, unclosed)
            written = emphasis.html
            end = emphasis.end
        } else if (
            character === '[' ||
            (character === '!' && text[at + 1] === '[')
        ) {
            const link = linked ? undefined : linkAt(text, at, settings)
            if (link) {
                written = link.html
                end = link.end
            }
        } else if (character === '<') {
            const autolink = linked ? undefined : autolinkAt(text, at, settings)
            if (autolink) {
                written = autolink.html
                end = autolink.end
            }
        } else if (character === 'h') {
            const url = linked ? undefined : bareUrlAt(text, at, settings)
            if (url) {
                written = url.html
                end = url.end
            }
        }
        if (written === undefined) {
            at += 1
            continue
        }
        html += escape(text.slice(plain, at)) + written
        at = end
        plain = end
    }
    return html + escape(text.slice(plain))
}

function runOf(text: string, at: number): number {
    const character = text[at]
    let end = at
    while (text[end] === character) end += 1
    return end - at
}

/** Where a run of exactly `run` backticks starts at or after `from`, or `-1`. */
function closingTicks(text: string, from: number, run: number): number {
    let at = text.indexOf('`', from)
    while (at !== -1) {
        const length = runOf(text, at)
        if (length === run) return at
        at = text.indexOf('`', at + length)
    }
    return -1
}

const EMPHASIS_TAGS = ['', 'em', 'strong'] as const

function emphasisAt(
    text: string,
    at: number,
    settings: Settings,
    linked: boolean,
    unclosed: Set<string>,
): { html: string; end: number } {
    const character = text[at] as string
    const run = runOf(text, at)
    const literal = { html: escape(character.repeat(run)), end: at + run }
    const key = `${character}${run}`
    if (run > 3 || (character === '~' && run !== 2) || unclosed.has(key))
        return literal
    const after = text[at + run]
    if (after === undefined || /\s/.test(after)) return literal
    if (character === '_' && at > 0 && WORD.test(text[at - 1] as string))
        return literal
    let scan = at + run
    while (scan < text.length) {
        const next = text[scan]
        if (next === '`') {
            const ticks = runOf(text, scan)
            const close = closingTicks(text, scan + ticks, ticks)
            scan = close === -1 ? scan + ticks : close + ticks
            continue
        }
        if (next === '\\') {
            scan += 2
            continue
        }
        if (next !== character) {
            scan += 1
            continue
        }
        const length = runOf(text, scan)
        const before = text[scan - 1] as string
        const following = text[scan + length]
        if (
            length === run &&
            !/\s/.test(before) &&
            !(
                character === '_' &&
                following !== undefined &&
                WORD.test(following)
            )
        ) {
            const inner = inline(text.slice(at + run, scan), settings, linked)
            const html =
                character === '~'
                    ? `<del>${inner}</del>`
                    : run === 3
                      ? `<strong><em>${inner}</em></strong>`
                      : `<${EMPHASIS_TAGS[run]}>${inner}</${EMPHASIS_TAGS[run]}>`
            return { html, end: scan + length }
        }
        scan += length
    }
    unclosed.add(key)
    return literal
}

// How far a link's text is looked for, which keeps a line of unmatched brackets linear.
const LABEL_REACH = 1000

function linkAt(
    text: string,
    at: number,
    settings: Settings,
): { html: string; end: number } | undefined {
    const image = text[at] === '!'
    const open = image ? at + 1 : at
    let depth = 0
    let close = -1
    for (
        let scan = open;
        scan < Math.min(text.length, open + LABEL_REACH);
        scan += 1
    ) {
        const character = text[scan]
        if (character === '\\') scan += 1
        else if (character === '[') depth += 1
        else if (character === ']') {
            depth -= 1
            if (depth === 0) {
                close = scan
                break
            }
        }
    }
    if (close === -1 || text[close + 1] !== '(') return undefined
    let scan = close + 2
    while (text[scan] === ' ') scan += 1
    let url = ''
    if (text[scan] === '<') {
        const end = text.indexOf('>', scan)
        if (end === -1) return undefined
        url = text.slice(scan + 1, end)
        if (/[<\n]/.test(url)) return undefined
        scan = end + 1
    } else {
        let parens = 0
        const from = scan
        while (scan < text.length) {
            const character = text[scan] as string
            if (character === '\\' && PUNCTUATION.test(text[scan + 1] ?? '')) {
                scan += 2
                continue
            }
            if (/\s/.test(character)) break
            if (character === '(') parens += 1
            else if (character === ')') {
                if (parens === 0) break
                parens -= 1
            }
            scan += 1
        }
        url = text.slice(from, scan).replace(/\\([!-/:-@[-`{-~])/g, '$1')
    }
    while (text[scan] === ' ') scan += 1
    const quote = text[scan]
    if (quote === '"' || quote === "'" || quote === '(') {
        const end = text.indexOf(quote === '(' ? ')' : quote, scan + 1)
        if (end === -1) return undefined
        scan = end + 1
        while (text[scan] === ' ') scan += 1
    }
    if (text[scan] !== ')') return undefined
    const label = text.slice(open + 1, close)
    const end = scan + 1
    const address = addressOf(url, settings)
    const inner = image
        ? escape(label === '' ? url : label)
        : label === ''
          ? escape(url)
          : inline(label, settings, true)
    return {
        html:
            address === undefined
                ? inner
                : `<a href="${escape(address)}">${inner}</a>`,
        end,
    }
}

function autolinkAt(
    text: string,
    at: number,
    settings: Settings,
): { html: string; end: number } | undefined {
    const rest = text.slice(at, at + 2048)
    const uri = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/.exec(rest)
    const email = uri
        ? undefined
        : /^<([^\s<>@\\]+@[^\s<>@\\]+\.[^\s<>@\\]+)>/.exec(rest)
    const matched = uri ?? email
    const written = matched?.[1]
    if (!matched || written === undefined) return undefined
    const address = addressOf(uri ? written : `mailto:${written}`, settings)
    const end = at + matched[0].length
    if (address === undefined) return { html: escape(written), end }
    return { html: `<a href="${escape(address)}">${escape(written)}</a>`, end }
}

function bareUrlAt(
    text: string,
    at: number,
    settings: Settings,
): { html: string; end: number } | undefined {
    if (!text.startsWith('http://', at) && !text.startsWith('https://', at))
        return undefined
    const before = text[at - 1]
    if (before !== undefined && !/[\s(*_~"']/.test(before)) return undefined
    let end = at
    while (end < text.length && !/[\s<]/.test(text[end] as string)) end += 1
    // Trailing punctuation ends the sentence rather than the address, and so does a `)` it never opened.
    while (end > at) {
        const last = text[end - 1] as string
        if (/[.,:;!?'"*_~]/.test(last)) end -= 1
        else if (last === ')') {
            const url = text.slice(at, end)
            const opened = url.split('(').length - 1
            const closed = url.split(')').length - 1
            if (closed > opened) end -= 1
            else break
        } else break
    }
    const url = text.slice(at, end)
    if (!/^https?:\/\/[^/]/.test(url)) return undefined
    const address = addressOf(url, settings)
    if (address === undefined) return undefined
    return { html: `<a href="${escape(address)}">${escape(url)}</a>`, end }
}
