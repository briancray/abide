// A `.abide` file becomes a node tree.
//
// The file is markup with three things spliced into it: `{expr}` holes, `{#block}` control flow, and
// top-level `<script>` / `<style>` blocks. Everything inside a `{...}` is TypeScript and is never
// interpreted here — `readExpression` finds where it ends and the text is carried through untouched,
// so a template expression is the same language as the rest of the file rather than a dialect of it.
//
// The parser is deliberately not a conforming HTML parser. It has to preserve exactly what the author
// wrote (the emitter re-emits the markup verbatim into an `html` template, and the RUNTIME parses
// that), so its only jobs are: find the holes, match the tags well enough to know where a block ends,
// and tell an element from a component.

import { readExpression, SyntaxError_ } from './lex.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

export interface Expr {
    /** The raw text between the braces, unmodified. */
    source: string
    /** Offset of the text in the original file — the anchor a source map is built from. */
    start: number
}

export type Attribute =
    | { kind: 'static'; name: string; value: string }
    | { kind: 'expression'; name: string; value: Expr }
    | { kind: 'interpolated'; name: string; parts: (string | Expr)[] }
    | { kind: 'event'; name: string; value: Expr }
    | { kind: 'bind'; target: string; value: Expr | null }
    | { kind: 'class'; name: string; value: Expr }
    | { kind: 'style'; name: string; value: Expr }
    | { kind: 'spread'; value: Expr }

export interface Branch {
    /** `{:else if c}` carries a condition; `{:else}` does not. `{:case v}` likewise. */
    test: Expr | null
    /** `{:then v}` / `{:catch e}` bind a name. */
    binding: string | null
    body: Node[]
}

export type Node =
    | { kind: 'text'; value: string }
    | { kind: 'expression'; value: Expr; raw: boolean }
    | { kind: 'element'; name: string; attributes: Attribute[]; children: Node[] }
    | { kind: 'component'; name: string; attributes: Attribute[]; children: Node[] }
    | { kind: 'slot' }
    | { kind: 'script'; body: string; start: number }
    /** A nested `<style>` — subtree-scoped. A top-level one is lifted into `Blocks.styles` instead. */
    | { kind: 'style'; body: string; start: number }
    | { kind: 'if'; branches: Branch[] }
    | {
          kind: 'for'
          item: string
          index: string | null
          list: Expr
          key: Expr | null
          streaming: boolean
          body: Node[]
          /** `{:catch}` on a streaming list. */
          failure: Branch | null
      }
    | { kind: 'await'; value: Expr; pending: Node[]; branches: Branch[] }
    | { kind: 'switch'; value: Expr; branches: Branch[] }
    | { kind: 'try'; body: Node[]; branches: Branch[] }
    | { kind: 'define'; name: string; parameters: string; body: Node[] }

export interface Blocks {
    /** `<script module>` — once per module. */
    module: { body: string; start: number } | null
    /** `<script>` — the component setup. */
    setup: { body: string; start: number } | null
    styles: { body: string; start: number }[]
    template: Node[]
}

// Blocks whose body ends at `{/name}`, and the branch keywords each accepts.
const BRANCHES: Record<string, Set<string>> = {
    if: new Set(['else']),
    for: new Set(['catch']),
    await: new Set(['then', 'catch', 'finally']),
    switch: new Set(['case', 'default']),
    try: new Set(['catch', 'finally']),
    component: new Set(),
}

/**
 * A whole JavaScript identifier and nothing else.
 *
 * Exported because `emit.ts` asks the same question of a name it is about to write into output —
 * whether a member can be a dotted access or has to be a quoted key, whether an attribute value is a
 * bare cell read. One grammar, so the two halves cannot disagree about what a name is. Anchored and
 * non-global, so `test` carries no `lastIndex` between callers.
 */
export const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

export class ParseError extends SyntaxError_ {}

interface Reader {
    source: string
    at: number
}

function fail(reader: Reader, message: string, at = reader.at): never {
    throw new ParseError(`abide: ${message}`, at)
}

/** Split the file into its top-level blocks and parse what is left as the template. */
export function parse(source: string): Blocks {
    const blocks: Blocks = { module: null, setup: null, styles: [], template: [] }

    // `<script>` and `<style>` hold raw text: their contents must not be scanned for `{` holes or
    // tags, so they are lifted out before the template parser ever sees them.
    let template = ''
    // The bodies of blocks left in the template — a nested `<script>`'s TypeScript, which is not
    // markup and must not be counted as any.
    const inert: Skipped[] = []
    let at = 0
    while (at < source.length) {
        const open = findRawBlock(source, at)
        if (open === null) {
            template += source.slice(at)
            break
        }
        // Template text BETWEEN blocks is carried through unchanged. Blanking it here cost a
        // component its entire markup whenever a block came after it — a `<style>` at the bottom of
        // the file, which is where one usually goes.
        template += source.slice(at, open.start)

        // A NESTED block belongs to the branch it sits in, not to the module, so it is left in the
        // template for the parser to pick up as a node. Lifting one would move its bindings to the
        // component setup, where they outlive the branch and are visible to everything.
        // Asked of `template`, which holds everything before this block with every lifted region
        // blanked to the same length — so offsets still index the original file, and no lifted
        // TypeScript is read as markup.
        if (enclosingDepth(template, open.start, inert) > 0) {
            template += source.slice(open.start, open.end)
            inert.push({ from: open.bodyStart, to: open.bodyEnd })
            at = open.end
            continue
        }

        // Offsets must survive the lift, so the removed block is replaced by the same number of
        // spaces — every Expr `start` then indexes the ORIGINAL file and a source map needs no
        // second coordinate system.
        template += ' '.repeat(open.bodyStart - open.start)
        template += source.slice(open.bodyStart, open.bodyEnd).replace(/[^\n]/g, ' ')
        template += ' '.repeat(open.end - open.bodyEnd)

        const body = source.slice(open.bodyStart, open.bodyEnd)
        if (open.tag === 'style') {
            blocks.styles.push({ body, start: open.bodyStart })
        } else if (open.module) {
            if (blocks.module !== null) fail({ source, at: open.start }, 'a second <script module> block')
            blocks.module = { body, start: open.bodyStart }
        } else {
            if (blocks.setup !== null) fail({ source, at: open.start }, 'a second <script> block')
            blocks.setup = { body, start: open.bodyStart }
        }
        at = open.end
    }

    // The template keeps the original offsets, so the lifted regions read as whitespace.
    const reader: Reader = { source: padTemplate(source, template), at: 0 }
    blocks.template = parseNodes(reader, null)
    return blocks
}

/**
 * The template text with every lifted block blanked out. Newlines survive so a reported line number
 * still matches the file the author is looking at.
 */
function padTemplate(source: string, template: string): string {
    if (template.length === source.length) return template
    // `findRawBlock` walks the source in order, so any shortfall is the tail.
    return template + ' '.repeat(source.length - template.length)
}

/**
 * How many elements and control-flow blocks are still open at `to`. Counted on the raw text rather
 * than on the node tree, because this question has to be answered BEFORE the template is parsed —
 * the lift is what decides which text the parser ever sees.
 *
 * Counted on the text with every lifted block ALREADY BLANKED, and skipping the body of any block
 * left in place. What is inside a `<script>` is TypeScript, and `Array<string>` is a generic rather
 * than an open tag — reading the raw file here counted one per generic, so a module block with two
 * of them put the `<script>` after it at depth 2 and dropped the component's whole setup.
 */
const ENCLOSING = /<(\/?)([A-Za-z][\w:.-]*)[^>]*>|\{([#/])/g

/** A region of the text that is not markup: a nested block's body, left in place for the parser. */
interface Skipped {
    from: number
    to: number
}

function enclosingDepth(text: string, to: number, skip: Skipped[]): number {
    let depth = 0
    // Bounded by `to` rather than by slicing to it — a slice here is a copy of everything before
    // the block, once per block found.
    ENCLOSING.lastIndex = 0
    for (;;) {
        const match = ENCLOSING.exec(text)
        if (match === null || match.index >= to) break

        let inside = false
        for (const region of skip) {
            if (match.index >= region.from && match.index < region.to) {
                inside = true
                break
            }
        }
        if (inside) continue

        const block = match[3]
        if (block !== undefined) {
            depth += block === '#' ? 1 : -1
            continue
        }
        // Before the closing-tag branch, so both halves of a lifted block are invisible: the opener
        // was already skipped as "never nesting", and a `</script>` that still decremented took the
        // depth one BELOW where the block found it.
        const name = (match[2] as string).toLowerCase()
        if (name === 'script' || name === 'style') continue
        if (match[1] === '/') {
            depth--
            continue
        }
        if (VOID_ELEMENTS.has(name) || match[0].endsWith('/>')) continue
        depth++
    }
    return depth
}

interface RawBlock {
    tag: 'script' | 'style'
    module: boolean
    start: number
    bodyStart: number
    bodyEnd: number
    end: number
}

const RAW_OPEN = /<(script|style)(\s[^>]*)?>/gi
// Case-insensitive closers rather than `source.toLowerCase().indexOf(…)`, which copies the whole
// file once per block found.
const RAW_CLOSE = { script: /<\/script>/gi, style: /<\/style>/gi }

function findRawBlock(source: string, from: number): RawBlock | null {
    RAW_OPEN.lastIndex = from
    const match = RAW_OPEN.exec(source)
    if (match === null) return null
    const tag = (match[1] as string).toLowerCase() as 'script' | 'style'
    const attributes = match[2] ?? ''
    const bodyStart = match.index + match[0].length
    const closer = RAW_CLOSE[tag]
    closer.lastIndex = bodyStart
    const closed = closer.exec(source)
    if (closed === null) {
        throw new ParseError(`abide: unclosed <${tag}>`, match.index)
    }
    const close = closed.index
    return {
        tag,
        module: /\bmodule\b/.test(attributes),
        start: match.index,
        bodyStart,
        bodyEnd: close,
        end: close + tag.length + 3,
    }
}

// --- the template ----------------------------------------------------------

/** Read nodes until `</closing>` or a `{:`/`{/` that belongs to an enclosing block. */
function parseNodes(reader: Reader, closing: string | null): Node[] {
    const nodes: Node[] = []
    let text = ''

    const flush = (): void => {
        if (text.trim() !== '' || /[ \t]/.test(text)) nodes.push({ kind: 'text', value: text })
        text = ''
    }

    while (reader.at < reader.source.length) {
        const char = reader.source[reader.at] as string

        if (char === '{') {
            const marker = reader.source[reader.at + 1]
            if (marker === ':' || marker === '/') {
                flush()
                return nodes
            }
            flush()
            nodes.push(parseHole(reader))
            continue
        }

        if (char === '<') {
            const next = reader.source[reader.at + 1]
            if (next === '/') {
                const end = reader.source.indexOf('>', reader.at)
                if (end < 0) fail(reader, 'unclosed end tag')
                const name = reader.source.slice(reader.at + 2, end).trim()
                if (closing === null) fail(reader, `</${name}> closes nothing`)
                if (name !== closing) fail(reader, `</${name}> does not close <${closing}>`)
                reader.at = end + 1
                flush()
                return nodes
            }
            if (next === '!') {
                // A comment is markup the runtime is happy to parse; carry it through.
                const end = reader.source.indexOf('-->', reader.at)
                const stop = end < 0 ? reader.source.length : end + 3
                text += reader.source.slice(reader.at, stop)
                reader.at = stop
                continue
            }
            if (next !== undefined && /[A-Za-z]/.test(next)) {
                flush()
                nodes.push(parseTag(reader))
                continue
            }
        }

        text += char
        reader.at++
    }

    if (closing !== null) fail(reader, `<${closing}> was never closed`)
    flush()
    return nodes
}

/** `{expr}`, `{#block …}` or `{...spread}` in child position. */
function parseHole(reader: Reader): Node {
    if (reader.source[reader.at + 1] === '#') return parseBlock(reader)
    const start = reader.at
    const { text, end } = readExpression(reader.source, start)
    reader.at = end + 1
    const trimmed = text.trim()
    // `{html(...)}` is the raw escape hatch (SPEC), which the runtime spells `raw(...)`.
    const raw = /^html\s*\(/.test(trimmed)
    return {
        kind: 'expression',
        raw,
        value: { source: trimmed, start: start + 1 + (text.length - text.trimStart().length) },
    }
}

function parseTag(reader: Reader): Node {
    const start = reader.at
    reader.at++ // '<'
    const nameEnd = scanWhile(reader, /[\w:.-]/)
    const name = reader.source.slice(start + 1, nameEnd)
    reader.at = nameEnd

    // A nested `<script>`/`<style>` holds RAW text: no holes, no tags, nothing the template parser
    // may look inside. Only a nested one reaches here — top-level blocks were lifted before parsing.
    const lower = name.toLowerCase()
    if (lower === 'script' || lower === 'style') {
        const block = findRawBlock(reader.source, start)
        if (block === null || block.start !== start) fail(reader, `unclosed <${name}>`, start)
        if (block.module) {
            fail(reader, '<script module> is module scope, so it cannot be nested in a branch', start)
        }
        reader.at = block.end
        return {
            kind: lower === 'style' ? 'style' : 'script',
            body: reader.source.slice(block.bodyStart, block.bodyEnd),
            start: block.bodyStart,
        }
    }

    const attributes = parseAttributes(reader)

    let selfClosing = false
    if (reader.source[reader.at] === '/') {
        selfClosing = true
        reader.at++
    }
    if (reader.source[reader.at] !== '>') fail(reader, `unclosed <${name}> tag`)
    reader.at++

    if (name === 'slot') {
        if (!selfClosing) parseNodes(reader, 'slot')
        return { kind: 'slot' }
    }

    const component = /^[A-Z]/.test(name)
    const children =
        selfClosing || (!component && VOID_ELEMENTS.has(name.toLowerCase())) ? [] : parseNodes(reader, name)

    return component
        ? { kind: 'component', name, attributes, children }
        : { kind: 'element', name, attributes, children }
}

function parseAttributes(reader: Reader): Attribute[] {
    const attributes: Attribute[] = []
    for (;;) {
        skipSpace(reader)
        const char = reader.source[reader.at]
        if (char === undefined || char === '>' || char === '/') return attributes

        if (char === '{') {
            const start = reader.at
            const { text, end } = readExpression(reader.source, start)
            reader.at = end + 1
            const trimmed = text.trim()
            if (!trimmed.startsWith('...')) {
                fail(
                    reader,
                    'a bare {…} in a tag must be a spread — write `{...props}` or `name={value}`',
                    start,
                )
            }
            // The `start` must point at the expression the `source` holds, not at the `{` — every
            // later read slices the ORIGINAL file from it, so the three dots have to be counted off.
            const inner = trimmed.slice(3)
            attributes.push({
                kind: 'spread',
                value: {
                    source: inner.trim(),
                    start:
                        start +
                        1 +
                        (text.length - text.trimStart().length) +
                        3 +
                        (inner.length - inner.trimStart().length),
                },
            })
            continue
        }

        const nameStart = reader.at
        const nameEnd = scanWhile(reader, /[\w:@.$-]/)
        if (nameEnd === nameStart) fail(reader, `unexpected \`${char}\` in a tag`)
        const name = reader.source.slice(nameStart, nameEnd)
        reader.at = nameEnd

        skipSpace(reader)
        if (reader.source[reader.at] !== '=') {
            attributes.push(classify(reader, name, null, nameStart))
            continue
        }
        reader.at++
        skipSpace(reader)

        const value = reader.source[reader.at]
        if (value === '{') {
            const start = reader.at
            const { text, end } = readExpression(reader.source, start)
            reader.at = end + 1
            attributes.push(classify(reader, name, { source: text.trim(), start: start + 1 }, nameStart))
            continue
        }
        if (value === '"' || value === "'") {
            attributes.push(parseQuoted(reader, name, value))
            continue
        }
        // Unquoted literal: `type=text`.
        const literalStart = reader.at
        const literalEnd = scanWhile(reader, /[^\s>]/)
        reader.at = literalEnd
        attributes.push({
            kind: 'static',
            name,
            value: reader.source.slice(literalStart, literalEnd),
        })
    }
}

/** `name="a {b} c"` — literal and holes mixed. The compiler owns the whole value. */
function parseQuoted(reader: Reader, name: string, quote: string): Attribute {
    reader.at++ // the opening quote
    const parts: (string | Expr)[] = []
    let literal = ''
    while (reader.at < reader.source.length) {
        const char = reader.source[reader.at] as string
        if (char === quote) {
            reader.at++
            if (literal !== '') parts.push(literal)
            // No holes at all — an ordinary static attribute, and the emitter can leave it in markup.
            if (parts.length === 0) return { kind: 'static', name, value: '' }
            if (parts.length === 1 && typeof parts[0] === 'string') {
                return { kind: 'static', name, value: parts[0] }
            }
            return { kind: 'interpolated', name, parts }
        }
        if (char === '{') {
            const start = reader.at
            const { text, end } = readExpression(reader.source, start)
            // `{'{'}` is how a literal brace is written (SPEC), so a lone-string hole folds back
            // into the literal rather than becoming a slot.
            const trimmed = text.trim()
            const literalBrace = /^(['"])(.*)\1$/s.exec(trimmed)
            if (literalBrace !== null) {
                literal += literalBrace[2] as string
            } else {
                if (literal !== '') parts.push(literal)
                literal = ''
                parts.push({ source: trimmed, start: start + 1 })
            }
            reader.at = end + 1
            continue
        }
        literal += char
        reader.at++
    }
    fail(reader, `unterminated ${quote} in an attribute value`)
}

function classify(reader: Reader, name: string, value: Expr | null, at: number): Attribute {
    if (name.startsWith('bind:')) {
        return { kind: 'bind', target: name.slice(5), value }
    }
    if (name.startsWith('class:')) {
        if (value === null) fail(reader, `class:${name.slice(6)} needs a value`, at)
        return { kind: 'class', name: name.slice(6), value }
    }
    if (name.startsWith('style:')) {
        if (value === null) fail(reader, `style:${name.slice(6)} needs a value`, at)
        return { kind: 'style', name: name.slice(6), value }
    }
    if (value === null) return { kind: 'static', name, value: '' }
    // `on<event>` is a listener on an element and an ordinary prop on a component; the emitter
    // decides, because only it knows which tag this sits on.
    if (/^on[a-z]+$/.test(name)) return { kind: 'event', name: name.slice(2), value }
    return { kind: 'expression', name, value }
}

// --- control flow ----------------------------------------------------------

function parseBlock(reader: Reader): Node {
    const open = reader.at
    const { text, end } = readExpression(reader.source, open)
    reader.at = end + 1
    const header = text.slice(1).trim() // past the '#'
    const space = header.search(/\s/)
    const name = space < 0 ? header : header.slice(0, space)
    const rest = space < 0 ? '' : header.slice(space + 1).trim()
    const headerStart = open + 2 + (space < 0 ? name.length : space + 1)

    if (BRANCHES[name] === undefined) fail(reader, `unknown block {#${name}}`, open)

    switch (name) {
        case 'if':
            return parseIf(reader, { source: rest, start: headerStart }, open)
        case 'for':
            return parseFor(reader, rest, headerStart, open)
        case 'await':
            return parseAwait(reader, rest, headerStart, open)
        case 'switch':
            return parseSwitch(reader, { source: rest, start: headerStart }, open)
        case 'try':
            return parseTry(reader)
        default:
            return parseDefine(reader, rest, open)
    }
}

interface Marker {
    /** `else`, `then`, `catch`, `finally`, `case`, `default` — or `''` for the closing `{/name}`. */
    keyword: string
    rest: string
    start: number
}

/** Read the `{:…}` or `{/…}` that ended a body. */
function takeMarker(reader: Reader, block: string): Marker {
    const open = reader.at
    if (reader.source[open] !== '{') fail(reader, `{#${block}} was never closed`, open)

    // `{/for}` is read with a plain scan, never through the JS lexer: a leading `/` in expression
    // position opens a REGEX, so `readExpression` would swallow the rest of the line looking for its
    // closing slash. A closing marker holds one identifier, so there is nothing to lex anyway.
    if (reader.source[open + 1] === '/') {
        const close = reader.source.indexOf('}', open)
        if (close < 0) fail(reader, `{#${block}} was never closed`, open)
        const closed = reader.source.slice(open + 2, close).trim()
        if (closed !== block) fail(reader, `{/${closed}} does not close {#${block}}`, open)
        reader.at = close + 1
        return { keyword: '', rest: '', start: open }
    }

    const { text, end } = readExpression(reader.source, open)
    reader.at = end + 1
    const inner = text.trim()
    const body = inner.slice(1).trim() // past the ':'
    const space = body.search(/\s/)
    const keyword = space < 0 ? body : body.slice(0, space)
    if (!(BRANCHES[block] as Set<string>).has(keyword)) {
        fail(reader, `{:${keyword}} is not a branch of {#${block}}`, open)
    }
    return {
        keyword,
        rest: space < 0 ? '' : body.slice(space + 1).trim(),
        start: open + 2 + (space < 0 ? keyword.length : space + 1),
    }
}

/**
 * The `{:keyword}` branches of a block, read until its `{/name}`.
 *
 * `{#await}` and `{#try}` name their branches the same way — the KEYWORD is the branch, and the rest
 * of the marker is the name it binds. `{#if}` and `{#switch}` do not (a condition follows the
 * keyword), so they keep their own loops.
 */
function collectBranches(reader: Reader, block: string): Branch[] {
    const branches: Branch[] = []
    for (;;) {
        const marker = takeMarker(reader, block)
        if (marker.keyword === '') return branches
        branches.push({
            test: { source: marker.keyword, start: marker.start },
            binding: marker.rest || null,
            body: parseNodes(reader, null),
        })
    }
}

function parseIf(reader: Reader, test: Expr, open: number): Node {
    if (test.source === '') fail(reader, '{#if} needs a condition', open)
    const branches: Branch[] = [{ test, binding: null, body: parseNodes(reader, null) }]
    for (;;) {
        const marker = takeMarker(reader, 'if')
        if (marker.keyword === '') return { kind: 'if', branches }
        // `{:else if c}` is one keyword and a condition; `{:else}` has neither.
        const elseIf = /^if\s+([\s\S]+)$/.exec(marker.rest)
        branches.push({
            test: elseIf === null ? null : { source: (elseIf[1] as string).trim(), start: marker.start + 3 },
            binding: null,
            body: parseNodes(reader, null),
        })
    }
}

const FOR_HEADER = /^(await\s+)?([\s\S]+?)\s+of\s+([\s\S]+)$/

function parseFor(reader: Reader, rest: string, at: number, open: number): Node {
    const match = FOR_HEADER.exec(rest)
    if (match === null) fail(reader, '{#for} reads `item, i of list by key`', open)
    const streaming = match[1] !== undefined
    const bindings = (match[2] as string).trim()
    let tail = (match[3] as string).trim()

    let key: Expr | null = null
    const by = findKeyword(tail, 'by')
    if (by >= 0) {
        key = { source: tail.slice(by + 3).trim(), start: at + rest.indexOf(tail) + by + 3 }
        tail = tail.slice(0, by).trim()
    }

    const comma = bindings.lastIndexOf(',')
    const item = comma < 0 ? bindings : bindings.slice(0, comma).trim()
    const index = comma < 0 ? null : bindings.slice(comma + 1).trim()
    if (index !== null && !IDENTIFIER.test(index)) {
        fail(reader, `{#for} index \`${index}\` is not an identifier`, open)
    }

    const body = parseNodes(reader, null)
    let failure: Branch | null = null
    for (;;) {
        const marker = takeMarker(reader, 'for')
        if (marker.keyword === '') break
        failure = { test: null, binding: marker.rest || null, body: parseNodes(reader, null) }
    }
    return {
        kind: 'for',
        item,
        index,
        list: { source: tail, start: at + rest.indexOf(tail) },
        key,
        streaming,
        body,
        failure,
    }
}

/** The offset of a top-level `keyword` in an expression, ignoring one inside brackets or strings. */
function findKeyword(text: string, keyword: string): number {
    const pattern = new RegExp(`(^|[^\\w$])${keyword}(?=\\s)`, 'g')
    for (;;) {
        const match = pattern.exec(text)
        if (match === null) return -1
        const at = match.index + (match[1] as string).length
        if (balanced(text.slice(0, at))) return at
    }
}

function balanced(text: string): boolean {
    let depth = 0
    let quote = ''
    for (let i = 0; i < text.length; i++) {
        const char = text[i] as string
        if (quote !== '') {
            if (char === '\\') i++
            else if (char === quote) quote = ''
            continue
        }
        if (char === '"' || char === "'" || char === '`') quote = char
        else if (char === '(' || char === '[' || char === '{') depth++
        else if (char === ')' || char === ']' || char === '}') depth--
    }
    return depth === 0 && quote === ''
}

const AWAIT_INLINE = /^([\s\S]+?)\s+(then|catch)\s+([\w$]+)?$/

function parseAwait(reader: Reader, rest: string, at: number, open: number): Node {
    if (rest === '') fail(reader, '{#await} needs a value', open)
    // `{#await p then v}` — the compact blocking form: body IS that branch, no pending branch.
    const inline = AWAIT_INLINE.exec(rest)
    if (inline !== null) {
        const value = { source: (inline[1] as string).trim(), start: at }
        const branch: Branch = {
            test: null,
            binding: inline[3] ?? null,
            body: parseNodes(reader, null),
        }
        const marker = takeMarker(reader, 'await')
        if (marker.keyword !== '') fail(reader, 'the inline {#await … then} form takes no branches', open)
        return {
            kind: 'await',
            value,
            pending: [],
            branches: [{ ...branch, test: { source: inline[2] as string, start: at } }],
        }
    }

    const value = { source: rest, start: at }
    // The pending body first: it is everything before the first `{:then}`.
    const pending = parseNodes(reader, null)
    return { kind: 'await', value, pending, branches: collectBranches(reader, 'await') }
}

function parseSwitch(reader: Reader, value: Expr, open: number): Node {
    if (value.source === '') fail(reader, '{#switch} needs a value', open)
    const leading = parseNodes(reader, null)
    for (const node of leading) {
        if (node.kind !== 'text' || node.value.trim() !== '') {
            fail(reader, '{#switch} takes only {:case} and {:default} branches', open)
        }
    }
    const branches: Branch[] = []
    for (;;) {
        const marker = takeMarker(reader, 'switch')
        if (marker.keyword === '') return { kind: 'switch', value, branches }
        branches.push({
            test: marker.keyword === 'default' ? null : { source: marker.rest, start: marker.start },
            binding: null,
            body: parseNodes(reader, null),
        })
    }
}

function parseTry(reader: Reader): Node {
    const body = parseNodes(reader, null)
    return { kind: 'try', body, branches: collectBranches(reader, 'try') }
}

const DEFINE_HEADER = /^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/

function parseDefine(reader: Reader, rest: string, open: number): Node {
    const match = DEFINE_HEADER.exec(rest)
    if (match === null) fail(reader, '{#component} reads `Name(args)`', open)
    const name = match[1] as string
    if (!/^[A-Z]/.test(name)) {
        fail(reader, `{#component ${name}} must be TitleCase — lowercase is reserved for element tags`, open)
    }
    const body = parseNodes(reader, null)
    takeMarker(reader, 'component')
    return { kind: 'define', name, parameters: (match[2] as string).trim(), body }
}

// --- small readers ---------------------------------------------------------

function skipSpace(reader: Reader): void {
    while (reader.at < reader.source.length && /\s/.test(reader.source[reader.at] as string)) reader.at++
}

function scanWhile(reader: Reader, pattern: RegExp): number {
    let at = reader.at
    while (at < reader.source.length && pattern.test(reader.source[at] as string)) at++
    return at
}
