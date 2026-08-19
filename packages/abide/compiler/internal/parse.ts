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

import { SyntaxKind } from 'typescript/unstable/ast'
import { readExpression, SyntaxError_, tokensOf } from './lex.ts'
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
    /** `{:catch e}` binds a name. */
    binding: string | null
    body: Node[]
}

export type Node =
    | { kind: 'text'; value: string }
    | { kind: 'expression'; value: Expr; raw: boolean }
    | { kind: 'element'; name: string; attributes: Attribute[]; children: Node[] }
    /** `start` is the TAG's offset — what a diagnostic about the invocation points at. */
    | { kind: 'component'; name: string; attributes: Attribute[]; children: Node[]; start: number }
    /**
     * `<slot/>`, and `<slot>…</slot>` whose children are the FALLBACK.
     *
     * Empty for the self-closing form, which is what keeps that form free: `emit.ts` only reaches for
     * the thunk and the effect `slotted` needs when there is something to fall back TO.
     */
    | { kind: 'slot'; start: number; fallback: Node[] }
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

/**
 * What a branch keyword takes after itself, and whether it may be left off.
 *
 * `tail` is the SPELLING rather than a grammar — `<value>`, `if <condition>` — because its readers are
 * a hover and a docs page, which show it to a person. `optional: false` is the one field that changes
 * what compiles: it makes the tail required.
 */
export interface BranchTail {
    tail: string
    optional: boolean
}

// Blocks whose body ends at `{/name}`, the branch keywords each accepts, and what each of those takes.
//
// Exported because it is the closed set of BLOCKS, and `/docs/syntax` claims to document all of them:
// `dogfood/test/docs.test.ts` compares `SPELLINGS.ts` against this in both directions, so a sixth block
// is a red gate until it has a page and a rung.
export const BRANCHES: Record<string, Record<string, BranchTail>> = {
    // `{:else}` and `{:else if c}` are ONE keyword: the `if` is read out of the tail by `parseIf`,
    // which is why it could never be found by anything reading a list of branch names.
    if: { else: { tail: 'if <condition>', optional: true } },
    for: { catch: { tail: '<error>', optional: true } },
    switch: {
        // NOT optional, and this is the one entry that changes what compiles: a bare `{:case}` used to
        // be accepted and emitted `a ===  ? …`, which is not JavaScript. The table refuses it now.
        case: { tail: '<value>', optional: false },
        default: { tail: '', optional: true },
    },
    try: {
        catch: { tail: '<error>', optional: true },
        finally: { tail: '', optional: true },
    },
    component: {},
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
        // Blanked a RUN at a time rather than a character at a time. The common shape of a lifted
        // `<script>` is a line with no newline in it, and `/[^\n]/g` visits every character of every
        // one of them — 51% of all source bytes across the dogfood app, and the largest single
        // self-time line in a compile. Same idiom `parseNodes` uses one function away.
        for (let at = open.bodyStart; at < open.bodyEnd; ) {
            const line = source.indexOf('\n', at)
            const stop = line === -1 || line >= open.bodyEnd ? open.bodyEnd : line
            template += ' '.repeat(stop - at)
            if (stop === open.bodyEnd) break
            template += '\n'
            at = stop + 1
        }
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
    blocks.template = blockBody(reader)
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
 *
 * A COMMENT is matched first and then ignored, which is what keeps prose from being counted as
 * markup. The alternation is what does the work: a comment is consumed whole, so a `{#for}` an
 * author wrote ABOUT the syntax cannot open a block. Writing that sentence in a file's own header
 * comment is exactly how this was found — the `<script module>` under it was then read as nested,
 * and the error named a branch nobody had written.
 */
const ENCLOSING = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)[^>]*>|\{([#/])/g

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
        // A comment: no capture group, so neither arm below applies. Consumed whole by the match,
        // which is the point — nothing inside it was ever offered to this loop.
        if (match[2] === undefined) continue
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

/**
 * A body that ends at a `{:`/`{/`, with the whitespace the SOURCE's own indentation left at either
 * end removed.
 *
 * A block written across lines opens with the newline and indent before its first node and closes
 * with the indent before `{/for}`. Those are two static text nodes PER ITERATION, and they join the
 * row's movable range: a keyed move relocates them alongside the row, so a 500-row reorder pays for
 * them 500 times. Measured on the media demo — 6.97 nodes moved per row against 5.00 once they are
 * gone, a 28% cut in DOM records for a reorder and 12% for a filter.
 *
 * Only whitespace CARRYING A NEWLINE is taken, and only at the two ends. A space written
 * deliberately between inline nodes — `<b>a</b> <b>b</b>` on one line — has no newline in it and
 * survives, because that is the one this would otherwise change the layout of. Indentation always
 * carries the newline that produced it.
 *
 * The case this DOES change: two blocks written back to back with no whitespace between them —
 * `{/if}{#if b}` — whose bodies each held an inline node. Their two indents were the only thing
 * separating the two words and both are now gone, so `x y` renders `xy`. Whitespace anywhere
 * OUTSIDE a body is untouched, which is why the ordinary shape (a block on its own lines, with
 * text around it) keeps its spacing: the run before `{#if}` is not part of the body.
 *
 * Verified against the perf app's four pages — every element's bounding box is identical before and
 * after, on the media page with 500 component rows included.
 */
function blockBody(reader: Reader): Node[] {
    const nodes = parseNodes(reader, null)
    let start = 0
    let end = nodes.length
    if (start < end && isFormatting(nodes[start])) start += 1
    if (end > start && isFormatting(nodes[end - 1])) end -= 1
    return start === 0 && end === nodes.length ? nodes : nodes.slice(start, end)
}

/**
 * A comment in the markup.
 *
 * Here rather than in `emit.ts` for the reason `IDENTIFIER` is: both halves ask what a comment is —
 * the emitter drops them from output, and the boundary trim below has to see PAST one to find the
 * indentation behind it — and a boundary they disagreed about would leave a stray text node in the
 * document that neither file looks like it produced.
 *
 * `.replace` only: a `/g` regex is stateful under `.test` and `.exec`, and this one is shared.
 */
export const HTML_COMMENT = /<!--[\s\S]*?-->/g

/**
 * Text that renders NOTHING and carries a newline — the file's own formatting.
 *
 * Comments are stripped first because the emitter drops them too: a component whose template opens
 * with a doc comment on its own line leaves the newline behind it as a text node, and that node is
 * then a permanent member of every instance's movable range. Asking `trim()` alone would keep it,
 * having seen the comment text and called it content.
 */
function isFormatting(node: Node | undefined): boolean {
    if (node === undefined || node.kind !== 'text') return false
    const rendered = node.value.replace(HTML_COMMENT, '')
    return rendered.trim() === '' && rendered.includes('\n')
}

/** Read nodes until `</closing>` or a `{:`/`{/` that belongs to an enclosing block. */
function parseNodes(reader: Reader, closing: string | null): Node[] {
    const nodes: Node[] = []
    let text = ''

    const flush = (): void => {
        if (meaningful(text)) nodes.push({ kind: 'text', value: text })
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
            if (next !== undefined && TAG_START.test(next)) {
                flush()
                nodes.push(parseTag(reader))
                continue
            }
        }

        // The common shape of a template is a long run of markup holding neither `{` nor `<`; take it
        // in one slice rather than a string index and a rope append per character. From `at + 1` so a
        // `<` that opened nothing — a literal `a < b` — is consumed here exactly as it was before.
        let run = reader.at + 1
        while (run < reader.source.length) {
            const code = reader.source.charCodeAt(run)
            if (code === 123 /* { */ || code === 60 /* < */) break
            run++
        }
        text += reader.source.slice(reader.at, run)
        reader.at = run
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
    const at = start + 1 + leading(text)

    // `{raw(...)}` is the escape hatch (SPEC). Syntactic, like every other decision on this path: the
    // name is what marks the slot, so nothing here needs to know what the expression evaluates to.
    const raw = /^raw\s*\(/.test(trimmed)
    return { kind: 'expression', raw, value: { source: trimmed, start: at } }
}

/**
 * The hole's text when it is ONE string literal and nothing else, or null.
 *
 * The question a regex over the first and last character could not ask: `'a' + b + 'c'` opens and
 * closes with a quote without being a literal, and folding it into the markup dropped every read
 * between them. `NoSubstitutionTemplateLiteral` counts — it is a literal with no holes by
 * definition — while a template WITH holes scans as `TemplateHead` and does not.
 */
function onlyStringLiteral(source: string): string | null {
    let found: string | null = null
    for (const token of tokensOf(source)) {
        if (found !== null) return null
        if (token.kind !== SyntaxKind.StringLiteral && token.kind !== SyntaxKind.NoSubstitutionTemplateLiteral) {
            return null
        }
        found = token.text.slice(1, -1)
    }
    return found
}

/**
 * How far into `text` the real expression starts.
 *
 * `code()` slices the ORIGINAL file from an `Expr.start` for `source.length` characters, so a source
 * that was trimmed while its start still points at the whitespace comes back SHORT by however many
 * characters were dropped — `{#if  count > 10}` emitted `if ($0 > 1)`, and `{ score * 100 }` emitted
 * `score() * 10`. Both type-check and both render wrong, which is why trimming and positioning have
 * to be one operation rather than two lines that agree by inspection.
 */
function leading(text: string): number {
    return text.length - text.trimStart().length
}

function parseTag(reader: Reader): Node {
    const start = reader.at
    reader.at++ // '<'
    const nameEnd = scanWhile(reader, TAG_NAME_CHAR)
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
        return { kind: 'slot', start, fallback: selfClosing ? [] : parseNodes(reader, 'slot') }
    }

    const component = /^[A-Z]/.test(name)
    const children =
        selfClosing || (!component && VOID_ELEMENTS.has(name.toLowerCase())) ? [] : parseNodes(reader, name)

    return component
        ? { kind: 'component', name, attributes, children, start }
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
                    start: start + 1 + leading(text) + 3 + leading(inner),
                },
            })
            continue
        }

        const nameStart = reader.at
        const nameEnd = scanWhile(reader, ATTRIBUTE_NAME_CHAR)
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
            attributes.push(
                classify(reader, name, { source: text.trim(), start: start + 1 + leading(text) }, nameStart),
            )
            continue
        }
        if (value === '"' || value === "'") {
            attributes.push(parseQuoted(reader, name, value))
            continue
        }
        // Unquoted literal: `type=text`.
        const literalStart = reader.at
        const literalEnd = scanWhile(reader, UNQUOTED_VALUE_CHAR)
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
    const quoteCode = quote.charCodeAt(0)
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
            // into the literal rather than becoming a slot. Decided by TOKEN: anchoring a regex on
            // the first and last character folded any expression that merely began and ended with a
            // quote, so `{'Delete ' + name + '?'}` became the text `Delete ' + name + '?` — the
            // reads inside it gone, with no error and nothing rendered wrong enough to notice.
            const trimmed = text.trim()
            const only = onlyStringLiteral(trimmed)
            if (only !== null) {
                literal += only
            } else {
                if (literal !== '') parts.push(literal)
                literal = ''
                parts.push({ source: trimmed, start: start + 1 + leading(text) })
            }
            reader.at = end + 1
            continue
        }
        // The common shape of an attribute value is a run holding neither the quote nor `{` — taken
        // in one slice rather than a string index and a rope append per character, which is the scan
        // `parseNodes` already takes over markup. From `at + 1`: this character is neither, or one of
        // the two arms above would have consumed it.
        let run = reader.at + 1
        while (run < reader.source.length) {
            const code = reader.source.charCodeAt(run)
            if (code === 123 /* { */ || code === quoteCode) break
            run++
        }
        literal += reader.source.slice(reader.at, run)
        reader.at = run
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
    const named = text.slice(1) // past the '#'
    const header = named.trim()
    const space = header.search(/\s/)
    const name = space < 0 ? header : header.slice(0, space)
    const tail = space < 0 ? '' : header.slice(space + 1)
    const rest = tail.trim()
    const headerStart = open + 2 + leading(named) + (space < 0 ? name.length : space + 1) + leading(tail)

    if (BRANCHES[name] === undefined) fail(reader, `unknown block {#${name}}`, open)

    switch (name) {
        case 'if':
            return parseIf(reader, { source: rest, start: headerStart }, open)
        case 'for':
            return parseFor(reader, rest, headerStart, open)
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
    const named = inner.slice(1) // past the ':'
    const body = named.trim()
    const space = body.search(/\s/)
    const keyword = space < 0 ? body : body.slice(0, space)
    const shape = (BRANCHES[block] as Record<string, BranchTail>)[keyword]
    if (shape === undefined) {
        fail(reader, `{:${keyword}} is not a branch of {#${block}}`, open)
    }
    const tail = space < 0 ? '' : body.slice(space + 1)
    // A required tail left off is the one branch-table entry that decides what COMPILES rather than
    // what a hover says — `{:case}` with no value emitted `a ===  ? …`, which is not JavaScript.
    if (!(shape as BranchTail).optional && tail.trim() === '') {
        fail(reader, `{:${keyword}} takes ${(shape as BranchTail).tail}`, open)
    }
    return {
        keyword,
        rest: tail.trim(),
        start:
            open +
            1 +
            leading(text) +
            1 +
            leading(named) +
            (space < 0 ? keyword.length : space + 1) +
            leading(tail),
    }
}

function parseIf(reader: Reader, test: Expr, open: number): Node {
    if (test.source === '') fail(reader, '{#if} needs a condition', open)
    const branches: Branch[] = [{ test, binding: null, body: blockBody(reader) }]
    for (;;) {
        const marker = takeMarker(reader, 'if')
        if (marker.keyword === '') return { kind: 'if', branches }
        // `{:else if c}` is one keyword and a condition; `{:else}` has neither.
        const elseIf = /^if\s+([\s\S]+)$/.exec(marker.rest)
        branches.push({
            // Located in the REST rather than at a fixed `+ 3`: `{:else if  c}` puts more than one
            // space between the keyword and the condition, and `\s+` in the pattern above ate it.
            test:
                elseIf === null
                    ? null
                    : {
                          source: (elseIf[1] as string).trim(),
                          start: marker.start + marker.rest.indexOf(elseIf[1] as string),
                      },
            binding: null,
            body: blockBody(reader),
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
    const by = findBy(tail)
    if (by >= 0) {
        const named = tail.slice(by + 3)
        key = { source: named.trim(), start: at + rest.indexOf(tail) + by + 3 + leading(named) }
        tail = tail.slice(0, by).trim()
    }

    const comma = bindings.lastIndexOf(',')
    const item = comma < 0 ? bindings : bindings.slice(0, comma).trim()
    const index = comma < 0 ? null : bindings.slice(comma + 1).trim()
    if (index !== null && !IDENTIFIER.test(index)) {
        fail(reader, `{#for} index \`${index}\` is not an identifier`, open)
    }

    const body = blockBody(reader)
    let failure: Branch | null = null
    for (;;) {
        const marker = takeMarker(reader, 'for')
        if (marker.keyword === '') break
        failure = { test: null, binding: marker.rest || null, body: blockBody(reader) }
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

/** `by` as a WORD rather than as the tail of one — `sortedBy` and `by` differ only in what precedes. */
const BY_KEYWORD = /(^|[^\w$])by(?=\s)/g

/** The offset of the top-level `by` in a `{#for}` tail, ignoring one inside brackets or strings. */
function findBy(text: string): number {
    BY_KEYWORD.lastIndex = 0
    for (;;) {
        const match = BY_KEYWORD.exec(text)
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

function parseSwitch(reader: Reader, value: Expr, open: number): Node {
    if (value.source === '') fail(reader, '{#switch} needs a value', open)
    const before = blockBody(reader)
    for (const node of before) {
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
            body: blockBody(reader),
        })
    }
}

/**
 * `{#try}` — the one block whose branches are named by the KEYWORD alone, with the rest of the
 * marker as the name it binds. `{#if}` and `{#switch}` put a condition after theirs, so they read
 * their own markers.
 */
function parseTry(reader: Reader): Node {
    const body = blockBody(reader)
    const branches: Branch[] = []
    for (;;) {
        const marker = takeMarker(reader, 'try')
        if (marker.keyword === '') return { kind: 'try', body, branches }
        branches.push({
            test: { source: marker.keyword, start: marker.start },
            binding: marker.rest || null,
            body: blockBody(reader),
        })
    }
}

const DEFINE_HEADER = /^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/

function parseDefine(reader: Reader, rest: string, open: number): Node {
    const match = DEFINE_HEADER.exec(rest)
    if (match === null) fail(reader, '{#component} reads `Name(args)`', open)
    const name = match[1] as string
    if (!/^[A-Z]/.test(name)) {
        fail(reader, `{#component ${name}} must be TitleCase — lowercase is reserved for element tags`, open)
    }
    const body = blockBody(reader)
    takeMarker(reader, 'component')
    return { kind: 'define', name, parameters: (match[2] as string).trim(), body }
}

// --- small readers ---------------------------------------------------------

// HOISTED, because a regex literal is a fresh object every time it is EVALUATED: inside
// `skipSpace`'s loop condition that was one allocation per whitespace character, and at
// `scanWhile`'s three call sites one per tag and per attribute. Kept as regexes rather than
// charCode compares so the classes still mean exactly what they meant — `\s` includes the
// non-ASCII spaces, and a parser is the wrong place for a sweep to narrow a character class.
const WHITESPACE = /\s/
const TAG_NAME_CHAR = /[\w:.-]/
const TAG_START = /[A-Za-z]/
const ATTRIBUTE_NAME_CHAR = /[\w:@.$-]/
const UNQUOTED_VALUE_CHAR = /[^\s>]/

/**
 * Whether a run of text between nodes is worth a node of its own.
 *
 * A space or a tab is TEXT — it separates two words the author wrote. A run of only newlines is
 * layout in the source and nothing in the output. One walk that stops on the first answer, rather
 * than a `trim()` that copies the whole run to ask whether it was blank and a second scan after it.
 */
function meaningful(text: string): boolean {
    for (let i = 0; i < text.length; i++) {
        const char = text[i] as string
        if (char === ' ' || char === '\t' || !WHITESPACE.test(char)) return true
    }
    return false
}

function skipSpace(reader: Reader): void {
    while (reader.at < reader.source.length && WHITESPACE.test(reader.source[reader.at] as string)) reader.at++
}

function scanWhile(reader: Reader, pattern: RegExp): number {
    let at = reader.at
    while (at < reader.source.length && pattern.test(reader.source[at] as string)) at++
    return at
}
