// MARKDOWN AS HTML THAT IS SAFE BY CONSTRUCTION: every character of the source reaches the output
// escaped, and the only markup is what this file writes — so raw HTML in the source is text (52.8)
// save the few formatting tags a model writes on purpose, written with no attribute (52.46), a link
// keeps an address only on a scheme the caller allows (52.9), and an image is a link to it rather
// than a request for it (52.10).
//
// The source renders as SECTIONS, each starting on a line that opens a fresh block after a blank
// one, and a section renders the same alone as inside the whole. That is what lets a stream render
// only the section still growing (`Markdown.abide`, 52.18), and a source cut anywhere — an open
// fence, an open emphasis — renders what it has, with the next chunk rendering the whole (52.12).
//
// NOT `safeUrl`: that is the template's check over one fixed set, `data:` in it, where a link here
// is checked against the schemes its caller names.

import { escapeAttribute as escape } from '../escapeText.ts'
import { numericReferenceCharacter } from '../numericReferenceCharacter.ts'

/** 52.40 — where a link goes: its address, and the `target` and `rel` it opens with. */
export type LinkTarget = {
    href: string
    target?: string | undefined
    rel?: string | undefined
}

/** The settings a render runs under, defaults filled in. */
export type Settings = {
    schemes: readonly string[]
    headingLevel: number
    href: ((address: string) => string | LinkTarget | undefined) | undefined
    /** 52.41 — the addresses each reference label names, read from the whole source. */
    references: ReadonlyMap<string, string>
    /** 52.42 — the fenced blocks the caller renders itself, by the first word of the fence's info. */
    blocks: Readonly<Record<string, (source: string, info: string) => string>>
}

export const SCHEMES: readonly string[] = ['http', 'https', 'mailto']

/** Where a link to `url` goes, or `undefined` where it is written as its text. */
function addressOf(url: string, settings: Settings): LinkTarget | undefined {
    if (!allowed(url, settings.schemes)) return undefined
    if (settings.href === undefined) return { href: url }
    const answered = settings.href(url)
    return typeof answered === 'string' ? { href: answered } : answered
}

/** `inner` as a link to `target`: its address, and the `target` and `rel` it carries where it has them. */
function anchor(target: LinkTarget, inner: string): string {
    let attributes = ` href="${escape(target.href)}"`
    if (target.target !== undefined)
        attributes += ` target="${escape(target.target)}"`
    if (target.rel !== undefined) attributes += ` rel="${escape(target.rel)}"`
    return `<a${attributes}>${inner}</a>`
}

// 52.41 — `[label]: address "title"`, a definition a reference link elsewhere names.
const DEFINITION =
    /^ {0,3}\[((?:[^\]\\]|\\.){1,999})\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/

/** A reference label as it matches: case and runs of whitespace aside. */
function labelKey(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 52.41 — the definitions `text` holds outside its fences, the first of a label kept. */
export function referencesOf(text: string): Map<string, string> {
    const references = new Map<string, string>()
    let fence: Fence | undefined
    for (const line of text.split('\n')) {
        if (fence !== undefined) {
            if (closes(line, fence)) fence = undefined
            continue
        }
        fence = fenceOf(line)
        if (fence !== undefined) continue
        const definition = DEFINITION.exec(line)
        if (definition === null) continue
        const key = labelKey(definition[1] as string)
        if (!references.has(key)) references.set(key, definition[2] as string)
    }
    return references
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
const TASK = /^\[([ xX])\](?:[ \t]+|$)/
const TABLE_DELIMITER =
    /^ {0,3}\|?(?: *:?-+:? *\|)+(?: *:?-+:? *)?$|^ {0,3}\|? *:?-+:? *\|(?: *:?-+:? *\|?)*$/

type Fence = { marker: string; length: number; info: string }

// 52.49 — a line of `$$` or `\[` alone opens a block of math, which runs as a fence does.
const MATH_OPEN = /^ {0,3}(\$\$|\\\[)[ \t]*$/
const MATH_CLOSE: Readonly<Record<string, RegExp>> = {
    $: /^ {0,3}\$\$[ \t]*$/,
    '\\': /^ {0,3}\\\][ \t]*$/,
}

function fenceOf(line: string): Fence | undefined {
    const math = MATH_OPEN.exec(line)?.[1]
    if (math !== undefined)
        return { marker: math[0] as string, length: math.length, info: '' }
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
    const math = MATH_CLOSE[fence.marker]
    if (math !== undefined) return math.test(line)
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
 * its first character already rules a list item out. 52.43 — a code fence opening unindented is a
 * section of its own, whatever stands against it: its whole opening line opens one, and the first
 * line after its close that is not blank does.
 */
export function sectionEnd(text: string, from: number): number {
    let fence: Fence | undefined
    let afterBlank = false
    let fenced = false
    let fenceClosed = false
    let at = from
    while (at < text.length) {
        const newline = text.indexOf('\n', at)
        const complete = newline !== -1
        const line = text
            .slice(at, complete ? newline : text.length)
            .replace(/\r$/, '')
        const opensCode =
            complete &&
            (line[0] === '`' || line[0] === '~') &&
            fence === undefined
                ? fenceOf(line)
                : undefined
        if (at > from && fence === undefined && !blank(line)) {
            if (fenceClosed || opensCode !== undefined) return at
            if (
                afterBlank &&
                (complete ? !LIST_ITEM.test(line) : !/^[\d*+-]/.test(line)) &&
                line[0] !== ' ' &&
                line[0] !== '\t'
            )
                return at
        }
        if (!complete) return text.length
        if (fence !== undefined) {
            if (closes(line, fence)) {
                fence = undefined
                fenceClosed = fenced
            }
        } else {
            fence = fenceOf(line)
            fenced = at === from && opensCode !== undefined
        }
        afterBlank = fence === undefined && blank(line)
        at = newline + 1
    }
    return text.length
}

/**
 * `text`'s sections, from its first, as HTML: what `markdown` renders. 52.50 — `streaming` leaves out
 * what the last section is still writing (`settled`).
 */
export function render(
    text: string,
    settings: Settings,
    streaming: boolean,
): string {
    let html = ''
    let at = 0
    while (at < text.length) {
        const end = sectionEnd(text, at)
        const section = text.slice(at, end)
        html += renderSection(
            streaming && end === text.length ? settled(section) : section,
            settings,
        )
        at = end
    }
    return html
}

/**
 * 52.43 — the block a section is where it is one closed fence and nothing else, its name one of
 * `names`: the name, its source and the rest of its info.
 */
export function blockOf(
    section: string,
    names: readonly string[],
): { name: string; source: string; info: string } | undefined {
    const lines = section.replace(/\s+$/, '').split('\n')
    const fence = fenceOf((lines[0] ?? '').replace(/\r$/, ''))
    if (fence === undefined || lines.length < 2) return undefined
    const name = fence.info.split(/\s/)[0] ?? ''
    if (!names.includes(name)) return undefined
    if (!closes((lines.at(-1) as string).replace(/\r$/, ''), fence))
        return undefined
    for (let index = 1; index < lines.length - 1; index += 1)
        if (closes(lines[index] as string, fence)) return undefined
    return {
        name,
        source: lines.slice(1, -1).join('\n'),
        info: fence.info.slice(name.length).trim(),
    }
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
            if (MATH_CLOSE[fence.marker] !== undefined) {
                html += `<div data-math="display">${escape(code.join('\n'))}</div>`
                continue
            }
            const language = fence.info.split(/\s/)[0] ?? ''
            // 52.42 — a block the caller renders, handed its source and the info after its name.
            const block = Object.hasOwn(settings.blocks, language)
                ? settings.blocks[language]
                : undefined
            if (block !== undefined) {
                html += block(
                    code.join('\n'),
                    fence.info.slice(language.length).trim(),
                )
                continue
            }
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
        // 52.41 — a definition opening a block is read by `referencesOf`, and renders nothing.
        if (DEFINITION.test(line)) {
            index += 1
            continue
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
    for (const content of items) {
        // 52.48 — `[ ]` or `[x]` opening an item is its box, ticked or not.
        const task = TASK.exec(content[0] as string)
        if (task === null) {
            html += `<li>${blocks(content, settings, !loose)}</li>`
            continue
        }
        const done = task[1] !== ' '
        content[0] = (content[0] as string).slice(task[0].length)
        html += `<li data-task="${done ? 'done' : 'open'}"><input type="checkbox" disabled${done ? ' checked' : ''}> ${blocks(content, settings, !loose)}</li>`
    }
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

const SPECIAL = /[\\`*_~[!<h&$]/g
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
            const math =
                next === '(' || next === '['
                    ? bracketMathAt(text, at)
                    : undefined
            if (math) {
                written = math.html
                end = math.end
            } else if (next !== undefined && PUNCTUATION.test(next)) {
                written = escape(next)
                end = at + 2
            }
        } else if (character === '$') {
            const math = dollarMathAt(text, at)
            if (math) {
                written = math.html
                end = math.end
            }
        } else if (character === '&') {
            const reference = referenceCharacterAt(text, at)
            if (reference) {
                written = escape(reference.character)
                end = reference.end
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
            const tagged =
                (linked ? undefined : autolinkAt(text, at, settings)) ??
                tagAt(text, at, settings, linked)
            if (tagged) {
                written = tagged.html
                end = tagged.end
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
    if (close === -1) return undefined
    if (text[close + 1] !== '(')
        return referenceAt(text, open, close, image, settings)
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
        html: address === undefined ? inner : anchor(address, inner),
        end,
    }
}

/** 52.41 — `[text][label]`, `[text][]` or `[label]`, where a definition names the label. */
function referenceAt(
    text: string,
    open: number,
    close: number,
    image: boolean,
    settings: Settings,
): { html: string; end: number } | undefined {
    const label = text.slice(open + 1, close)
    let named = label
    let end = close + 1
    if (text[close + 1] === '[') {
        const shut = text.indexOf(']', close + 2)
        if (shut === -1) return undefined
        const written = text.slice(close + 2, shut)
        if (written !== '') named = written
        end = shut + 1
    }
    const url = settings.references.get(labelKey(named))
    if (url === undefined) return undefined
    const address = addressOf(url, settings)
    const inner = image ? escape(label) : inline(label, settings, true)
    return { html: address === undefined ? inner : anchor(address, inner), end }
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
    return { html: anchor(address, escape(written)), end }
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
    return { html: anchor(address, escape(url)), end }
}

// 52.49 — MATH IS KEPT AS ITS TEX, in an element an app can render it from: `$…$`, `$$…$$`, `\(…\)`
// and `\[…\]` on one line. A `$` opens only before a non-space and closes only after one, never
// before a digit, so the prices in `$5 and $10` stay text.
function dollarMathAt(
    text: string,
    at: number,
): { html: string; end: number } | undefined {
    if (text.startsWith('$$', at)) {
        const close = text.indexOf('$$', at + 2)
        if (close === -1 || close === at + 2) return undefined
        return {
            html: `<span data-math="display">${escape(text.slice(at + 2, close).trim())}</span>`,
            end: close + 2,
        }
    }
    const first = text[at + 1]
    if (first === undefined || /\s/.test(first)) return undefined
    let scan = at + 1
    while (scan < text.length) {
        const close = text.indexOf('$', scan)
        if (close === -1) return undefined
        const following = text[close + 1]
        if (
            text[close - 1] !== '\\' &&
            !/\s/.test(text[close - 1] as string) &&
            !(following !== undefined && /\d/.test(following))
        )
            return {
                html: `<span data-math="inline">${escape(text.slice(at + 1, close))}</span>`,
                end: close + 1,
            }
        scan = close + 1
    }
    return undefined
}

function bracketMathAt(
    text: string,
    at: number,
): { html: string; end: number } | undefined {
    const display = text[at + 1] === '['
    const close = text.indexOf(display ? '\\]' : '\\)', at + 2)
    if (close === -1) return undefined
    return {
        html: `<span data-math="${display ? 'display' : 'inline'}">${escape(text.slice(at + 2, close).trim())}</span>`,
        end: close + 2,
    }
}

// 52.47 — the named character references a model writes: markup it means as text, spaces and
// typography. The rest of HTML's two thousand stay as written, which keeps this off a page's bytes.
const NAMED_REFERENCES: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
    ensp: '\u2002',
    emsp: '\u2003',
    thinsp: '\u2009',
    zwj: '\u200d',
    zwnj: '\u200c',
    shy: '\u00ad',
    copy: '©',
    reg: '®',
    trade: '™',
    deg: '°',
    plusmn: '±',
    times: '×',
    divide: '÷',
    minus: '−',
    middot: '·',
    bull: '•',
    hellip: '…',
    ndash: '–',
    mdash: '—',
    lsquo: '‘',
    rsquo: '’',
    ldquo: '“',
    rdquo: '”',
    laquo: '«',
    raquo: '»',
    larr: '←',
    rarr: '→',
    uarr: '↑',
    darr: '↓',
    harr: '↔',
    rArr: '⇒',
    lArr: '⇐',
    le: '≤',
    ge: '≥',
    ne: '≠',
    asymp: '≈',
    infin: '∞',
    micro: 'µ',
    para: '¶',
    sect: '§',
    euro: '€',
    pound: '£',
    yen: '¥',
    cent: '¢',
    check: '✓',
    cross: '✗',
}

const CHARACTER_REFERENCE =
    /^&(?:#(\d{1,7})|#[xX]([\da-fA-F]{1,6})|([A-Za-z]{2,8}));/

function referenceCharacterAt(
    text: string,
    at: number,
): { character: string; end: number } | undefined {
    const match = CHARACTER_REFERENCE.exec(text.slice(at, at + 12))
    if (match === null) return undefined
    const named = match[3]
    const character =
        named !== undefined
            ? Object.hasOwn(NAMED_REFERENCES, named)
                ? NAMED_REFERENCES[named]
                : undefined
            : numericReferenceCharacter(
                  match[1] !== undefined
                      ? Number(match[1])
                      : Number.parseInt(match[2] as string, 16),
              )
    if (character === undefined) return undefined
    return { character, end: at + match[0].length }
}

// 52.46 — THE TAGS A MODEL WRITES ON PURPOSE, each written with no attribute: `<br>` anywhere — a table
// cell's line break — and a formatting tag around text its closing tag ends on the same line. A tag
// with an attribute, or one not here, is text.
const TAGS: ReadonlySet<string> = new Set([
    'b',
    'i',
    'u',
    's',
    'em',
    'strong',
    'del',
    'ins',
    'mark',
    'small',
    'sub',
    'sup',
    'kbd',
])

function tagAt(
    text: string,
    at: number,
    settings: Settings,
    linked: boolean,
): { html: string; end: number } | undefined {
    const br = /^<br[ \t]*\/?>/i.exec(text.slice(at, at + 8))
    if (br !== null) return { html: '<br>', end: at + br[0].length }
    const open = /^<([a-zA-Z]{1,6})>/.exec(text.slice(at, at + 9))
    const name = open?.[1]?.toLowerCase()
    if (open === null || name === undefined || !TAGS.has(name)) return undefined
    const closing = `</${name}>`
    const close = text.toLowerCase().indexOf(closing, at + open[0].length)
    if (close === -1) return undefined
    const inner = inline(
        text.slice(at + open[0].length, close),
        settings,
        linked,
    )
    return {
        html: `<${name}>${inner}</${name}>`,
        end: close + closing.length,
    }
}

// 52.50 — WHAT A STREAM IS STILL WRITING, LEFT OUT: the section as far as the next chunk cannot turn
// it into something else. A closing fence half written, a line that is a block's marker alone, a
// table's rows before the delimiter under its head is whole, and the end of the last line from an
// opening — of code, emphasis, a link or a tag — nothing closes yet. HELD AS FAR BACK AS
// `HOLD_REACH` ONLY: a model writes a paragraph as one line, and a `*` that was never emphasis must
// not hide the rest of it until the line ends.
const HOLD_REACH = 160
const HELD_LINE =
    /^ {0,3}(?:#{1,6}|[-*+]|\d{1,9}[.)]?|>|[-*_]{2}|`{1,2}|~{1,2}|\$|\\)[ \t]*$/

/** `section`, the last of a source still being written, without what the next chunk may yet change. */
export function settled(section: string): string {
    const lines = section.split('\n')
    const last = lines.length - 1
    const line = (lines[last] as string).replace(/\r$/, '')
    const upTo = (count: number) => lines.slice(0, count).join('\n')
    let fence: Fence | undefined
    for (let index = 0; index < last; index += 1) {
        const each = (lines[index] as string).replace(/\r$/, '')
        if (fence !== undefined) {
            if (closes(each, fence)) fence = undefined
        } else fence = fenceOf(each)
    }
    if (fence !== undefined)
        return closingStarted(line, fence) ? upTo(last) : section
    if (line === '') return section
    if (HELD_LINE.test(line)) return upTo(last)
    // A table's head waits for its delimiter, and its last row for the line to end.
    let head = last
    while (head > 0 && (lines[head - 1] as string).trimStart().startsWith('|'))
        head -= 1
    if (line.trimStart().startsWith('|')) {
        if (last - head < 2) return upTo(head)
        if (TABLE_DELIMITER.test(lines[head + 1] as string)) return upTo(last)
    }
    const from = heldFrom(line)
    if (from === undefined) return section
    const kept = line.slice(0, from)
    // What is held may leave the line a marker alone: `- [` waiting on its box or its link.
    if (HELD_LINE.test(kept) || kept.trim() === '') return upTo(last)
    return last === 0 ? kept : `${upTo(last)}\n${kept}`
}

/** Whether `line` is the start of what would close `fence`, and not yet all of it. */
function closingStarted(line: string, fence: Fence): boolean {
    const written = line.trimStart()
    const closing =
        fence.marker === '$'
            ? '$$'
            : fence.marker === '\\'
              ? '\\]'
              : fence.marker.repeat(fence.length)
    return (
        written !== '' &&
        written.length < closing.length &&
        closing.startsWith(written)
    )
}

/** Where the end of `line` a later chunk may still close starts, or `undefined` where nothing is open. */
function heldFrom(line: string): number | undefined {
    const floor = line.length - HOLD_REACH
    let held: number | undefined
    const hold = (at: number) => {
        if (at >= floor && (held === undefined || at < held)) held = at
    }
    const brackets: number[] = []
    const opened: { character: string; run: number; at: number }[] = []
    let at = 0
    while (at < line.length) {
        const character = line[at] as string
        if (character === '\\') {
            if (at === line.length - 1) hold(at)
            at += 2
            continue
        }
        if (character === '`') {
            const run = runOf(line, at)
            const close = closingTicks(line, at + run, run)
            if (close === -1) {
                hold(at)
                break
            }
            at = close + run
            continue
        }
        if (character === '[') {
            brackets.push(line[at - 1] === '!' ? at - 1 : at)
            at += 1
            continue
        }
        if (character === ']') {
            const open = brackets.pop()
            if (open !== undefined) {
                if (at === line.length - 1) hold(open)
                else if (line[at + 1] === '(') {
                    const close = parenClose(line, at + 2)
                    if (close === -1) hold(open)
                    else at = close
                }
            }
            at += 1
            continue
        }
        if (character === '*' || character === '_' || character === '~') {
            const run = runOf(line, at)
            const before = line[at - 1]
            const after = line[at + run]
            const top = opened.at(-1)
            const closes =
                before !== undefined &&
                !/\s/.test(before) &&
                !(character === '_' && after !== undefined && WORD.test(after))
            if (
                closes &&
                top !== undefined &&
                top.character === character &&
                top.run === run
            )
                opened.pop()
            // A run the line ends on may still open, or grow into one that does.
            else if (after === undefined) hold(at)
            else if (
                run <= 3 &&
                !(character === '~' && run !== 2) &&
                !/\s/.test(after) &&
                !(
                    character === '_' &&
                    before !== undefined &&
                    WORD.test(before)
                )
            )
                opened.push({ character, run, at })
            at += run
            continue
        }
        if (character === '<') {
            const rest = line.slice(at)
            if (/^<\/?[a-zA-Z]/.test(rest) && !rest.includes('>')) hold(at)
            else {
                const open = /^<([a-zA-Z]{1,6})>/.exec(rest)?.[1]?.toLowerCase()
                if (
                    open !== undefined &&
                    TAGS.has(open) &&
                    !rest.toLowerCase().includes(`</${open}>`)
                )
                    hold(at)
            }
        } else if (character === '&' && /^&#?[\w]*$/.test(line.slice(at)))
            hold(at)
        at += 1
    }
    for (const open of brackets) hold(open)
    for (const open of opened) hold(open.at)
    return held
}

/** Where the `)` ending a link's address from `from` is, or `-1`. */
function parenClose(line: string, from: number): number {
    let depth = 0
    for (let at = from; at < line.length; at += 1) {
        const character = line[at]
        if (character === '\\') at += 1
        else if (character === '(') depth += 1
        else if (character === ')') {
            if (depth === 0) return at
            depth -= 1
        }
    }
    return -1
}
