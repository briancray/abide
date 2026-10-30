import { dirname } from 'node:path' // bun exposes no path helpers of its own

import { SyntaxKind } from 'typescript/unstable/ast'

import { diagnosisAt, offsetOf } from './lineOf.ts'
import { nearest } from './nearest.ts'
import {
    type AbideFile,
    closeTagAt,
    ELSE_IF,
    forSeparators,
    parseAbide,
} from './parseAbide.ts'
import { sameTemplate } from './sameTemplate.ts'
import { isSpace, slotEnd, tokenize } from './tokenize.ts'
import type { Diagnosis } from './TypeSession.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

// 38.125, 38.126 — A `.abide` IS FORMATTED AS PIECES, and `bun fmt` formats every piece that is code: a
// script block as TypeScript, a style as CSS, and every expression in one batch of calls. What is
// left is the markup, which only abide can read, and abide only re-indents it. The scan here is
// LOSSLESS where `parseAbide`'s is not — it keeps the comments and the whitespace the parser drops
// — and it is held to the parser's reading by parsing the result and comparing the template it
// reads to the one it was (`sameTemplate`).

/** A run of the source as the emitter takes it. */
type Piece =
    /** Characters written as they stand. */
    | { kind: 'text'; text: string }
    /**
     * A whitespace run holding a newline, re-indented where it lands. `alone` where the run is a
     * whole text node of the template, which 38.127 holds to the kind it was.
     */
    | {
          kind: 'break'
          text: string
          place: 'markup' | 'tag' | 'tagEnd'
          alone: boolean
      }
    /** An element or a block opening, and its close — a block's next arm is both. */
    | { kind: 'open' }
    | { kind: 'close' }
    /**
     * An expression `bun fmt` formats. `raw` is what the source holds, written back where the
     * formatted text is refused; `fit` is where it stands — anywhere, inside an unquoted value, or
     * inside a value quoted by that quote.
     */
    | {
          kind: 'expression'
          text: string
          raw: string
          at: number
          fit: Fit
      }
    /** A `<script>` block's or a `<style>`'s body, and the close tag after it. */
    | {
          kind: 'code'
          text: string
          at: number
          language: 'ts' | 'css'
          close: string
      }

type Fit = 'any' | 'unquoted' | '"' | "'"
type Expression = Extract<Piece, { kind: 'expression' }>

/** What one file formats to, and what kept part of it as written. */
export type Formatted = { text: string; findings: Diagnosis[] }

/** What `bun fmt` printed for a piece, or why it refused — `line` and `column` within the piece. */
type Answer =
    | { text: string; error: undefined }
    | {
          text: undefined
          error: { message: string; line: number; column: number }
      }

/** Where an expression's call starts in the batch `bun fmt` is handed: `__abide_3(`. */
const ENTRY = /^__abide_(\d+|probe)\(/
const PROBE = '__abide_probe(() => {\nx\n})\n'
/** The elements whose body is not markup: code `bun fmt` formats, or text 38.127 keeps as written. */
const KEPT_BODY = new Set(['script', 'style', 'pre', 'textarea'])

/**
 * `text`, the `.abide` at `path`, formatted — or as written, with the reason, where the parser
 * refuses it or the result would read as a different template. 38.127, 38.128.
 */
export async function formatAbide(
    path: string,
    text: string,
): Promise<Formatted> {
    if (await ignoredByConfig(path)) return { text, findings: [] }
    const keptAsWritten = (message: string): Formatted => ({
        text,
        findings: [
            diagnosisAt(
                path,
                undefined,
                0,
                'error',
                `abide format: ${message}`,
            ),
        ],
    })
    let file: AbideFile
    try {
        file = parseAbide(text)
    } catch (thrown) {
        return keptAsWritten((thrown as Error).message)
    }
    // A `<script>` is TypeScript where the parser took it for a block rather than for markup.
    const { origins } = file
    const codeBlocks = new Set([
        ...origins.scripts,
        ...origins.modules,
        ...origins.servers,
        ...origins.setups,
    ])
    const pieces = piecesOf(text, codeBlocks)
    const expressions: Expression[] = []
    const codes: Extract<Piece, { kind: 'code' }>[] = []
    for (const piece of pieces)
        if (piece.kind === 'expression') expressions.push(piece)
        else if (piece.kind === 'code') codes.push(piece)
    const [batch, ...formattedCodes] = await Promise.all([
        formatExpressions(path, expressions),
        ...codes.map((code) =>
            runFormatter(`${path}.${code.language}`, code.text),
        ),
    ])
    const answered = [...expressions, ...codes]
    const answers = [...batch.answers, ...formattedCodes]
    const formatted = new Map<Piece, string>()
    const findings: Diagnosis[] = []
    for (const [index, piece] of answered.entries()) {
        const answer = answers[index] as Answer
        if (answer.text !== undefined) formatted.set(piece, answer.text)
        else
            findings.push(
                diagnosisAt(
                    path,
                    text,
                    piece.at +
                        offsetOf(text.slice(piece.at), {
                            line: answer.error.line - 1,
                            character: answer.error.column - 1,
                        }),
                    'error',
                    `bun fmt: ${answer.error.message}`,
                ),
            )
    }
    const result = emit(pieces, formatted, batch.unit)
    if (result === text) return { text, findings }
    let reread: AbideFile
    try {
        reread = parseAbide(result)
    } catch (thrown) {
        return keptAsWritten(
            `the formatted file no longer parses, so it was left as written — ${(thrown as Error).message}`,
        )
    }
    if (!sameTemplate(file, reread))
        return keptAsWritten(
            'the formatted file would parse to a different template, so it was left as written. RULEBOOK 38.127.',
        )
    return { text: result, findings }
}

/**
 * Whether the `ignorePatterns` of the nearest `bunfig.toml` holding a `[fmt]` names `path` — the
 * patterns `bun fmt` skips a file by, held to a `.abide` too (38.125). A pattern ending in `/` is a
 * directory at any depth; any other is a glob from the config's directory.
 */
async function ignoredByConfig(path: string): Promise<boolean> {
    let bunfig = nearest(dirname(path), 'bunfig.toml')
    while (bunfig !== undefined) {
        const directory = dirname(bunfig)
        const options = Bun.TOML.parse(await Bun.file(bunfig).text()) as {
            fmt?: { ignorePatterns?: string[] }
        }
        if (options.fmt !== undefined) {
            const relative = path.slice(directory.length + 1)
            for (const pattern of options.fmt.ignorePatterns ?? [])
                if (
                    pattern.endsWith('/')
                        ? `/${relative}`.includes(`/${pattern}`)
                        : new Bun.Glob(pattern).match(relative)
                )
                    return true
            return false
        }
        if (directory === dirname(directory)) return false
        bunfig = nearest(dirname(directory), 'bunfig.toml')
    }
    return false
}

/**
 * The file as pieces, in source order. Mirrors `parseAbide`'s reading of a tag (`readTag`), a slot
 * (`slotEnd`) and a raw-text body (`closeTagAt`), and keeps what that reading drops. `codeBlocks` is
 * where the parser found each script block's body starting.
 */
function piecesOf(source: string, codeBlocks: Set<number>): Piece[] {
    const pieces: Piece[] = []
    // The open elements and blocks, innermost last — a block as `null`, which no tag name is — so a
    // close tag closes only what it names, as the parser's `open` does.
    const open: (string | null)[] = []
    let textFrom = 0
    let at = 0

    const flushText = (until: number): void => {
        if (until > textFrom) pushText(pieces, source.slice(textFrom, until))
        textFrom = until
    }

    while (at < source.length) {
        const char = source[at]
        if (char === '<' && source.startsWith('<!', at)) {
            flushText(at)
            const closer = source.startsWith('<!--', at) ? '-->' : '>'
            const close = source.indexOf(closer, at + 2)
            const end = close === -1 ? source.length : close + closer.length
            pieces.push({ kind: 'text', text: source.slice(at, end) })
            at = textFrom = end
            continue
        }
        if (char === '<' && source[at + 1] === '/') {
            const close = source.indexOf('>', at)
            if (close === -1) break
            flushText(at)
            const name = source
                .slice(at + 2, close)
                .trim()
                .toLowerCase()
            if (open[open.length - 1] === name) {
                open.pop()
                pieces.push({ kind: 'close' })
            }
            pieces.push({ kind: 'text', text: source.slice(at, close + 1) })
            at = textFrom = close + 1
            continue
        }
        if (char === '<' && /[A-Za-z]/.test(source[at + 1] ?? '')) {
            flushText(at)
            const tag = tagPieces(source, at)
            pieces.push(...tag.pieces)
            at = textFrom = tag.end
            const lower = tag.name.toLowerCase()
            if (KEPT_BODY.has(lower)) {
                if (tag.selfClosing) continue
                const close = closeTagAt(source, lower, tag.end)
                if (close === null) {
                    pieces.push({ kind: 'text', text: source.slice(tag.end) })
                    at = textFrom = source.length
                    continue
                }
                const body = source.slice(tag.end, close.start)
                const closeTag = source.slice(close.start, close.end)
                const language =
                    lower === 'style'
                        ? 'css'
                        : lower === 'script' && codeBlocks.has(tag.end)
                          ? 'ts'
                          : undefined
                if (language === undefined)
                    pieces.push({ kind: 'text', text: body + closeTag })
                else
                    pieces.push({
                        kind: 'code',
                        text: body,
                        at: tag.end,
                        language,
                        close: closeTag,
                    })
                at = textFrom = close.end
                continue
            }
            if (!tag.selfClosing && !VOID_ELEMENTS.has(lower)) {
                open.push(lower)
                pieces.push({ kind: 'open' })
            }
            continue
        }
        if (char === '{') {
            flushText(at)
            const close = slotEnd(source, at)
            const raw = source.slice(at + 1, close)
            const inner = raw.trim()
            const innerAt = at + 1 + leadingSpace(raw)
            if (inner.startsWith('#')) {
                pieces.push(...headerPieces(inner, innerAt))
                open.push(null)
                pieces.push({ kind: 'open' })
            } else if (inner.startsWith(':')) {
                pieces.push(
                    { kind: 'close' },
                    ...headerPieces(inner, innerAt),
                    { kind: 'open' },
                )
            } else if (inner.startsWith('/')) {
                if (open[open.length - 1] === null) {
                    open.pop()
                    pieces.push({ kind: 'close' })
                }
                pieces.push({
                    kind: 'text',
                    text: `{/${inner.slice(1).trim()}}`,
                })
            } else if (inner === '')
                pieces.push({ kind: 'text', text: source.slice(at, close + 1) })
            else pieces.push(...slotOf(raw, at + 1, 'any'))
            at = textFrom = Math.min(close + 1, source.length)
            continue
        }
        at += 1
    }
    flushText(source.length)
    return pieces
}

/** A text run as pieces: its whitespace runs that hold a newline become breaks. */
function pushText(pieces: Piece[], text: string): void {
    const alone = text.trim() === ''
    let from = 0
    for (const match of text.matchAll(/[ \t\r\n]*\n[ \t\r\n]*/g)) {
        if (match.index > from)
            pieces.push({ kind: 'text', text: text.slice(from, match.index) })
        pieces.push({ kind: 'break', text: match[0], place: 'markup', alone })
        from = match.index + match[0].length
    }
    if (from < text.length)
        pieces.push({ kind: 'text', text: text.slice(from) })
}

/** An open tag as pieces, read the way `readTag` reads one. */
function tagPieces(
    source: string,
    open: number,
): { name: string; end: number; selfClosing: boolean; pieces: Piece[] } {
    let at = open + 1
    while (at < source.length && /[\w:-]/.test(source[at] as string)) at += 1
    const name = source.slice(open + 1, at)
    const pieces: Piece[] = [{ kind: 'text', text: `<${name}` }]
    while (at < source.length) {
        const spaceFrom = at
        while (at < source.length && isSpace(source[at] as string)) at += 1
        const space = source.slice(spaceFrom, at)
        const selfClosing = source[at] === '/' && source[at + 1] === '>'
        const closing = selfClosing || source[at] === '>'
        if (space.includes('\n'))
            pieces.push({
                kind: 'break',
                text: space,
                place: closing ? 'tagEnd' : 'tag',
                alone: false,
            })
        else if (space !== '' && !closing)
            pieces.push({ kind: 'text', text: ' ' })
        if (closing) {
            pieces.push({ kind: 'text', text: selfClosing ? ' />' : '>' })
            return {
                name,
                end: at + (selfClosing ? 2 : 1),
                selfClosing,
                pieces,
            }
        }
        if (source[at] === '{') {
            const close = slotEnd(source, at)
            const raw = source.slice(at + 1, close)
            if (raw.trimStart().startsWith('...')) {
                pieces.push(...slotOf(raw, at + 1, 'any'))
                at = close + 1
                continue
            }
        }
        const nameFrom = at
        while (
            at < source.length &&
            !isSpace(source[at] as string) &&
            source[at] !== '=' &&
            source[at] !== '/' &&
            source[at] !== '>'
        )
            at += 1
        if (at === nameFrom) {
            pieces.push({ kind: 'text', text: source[at] ?? '' })
            return { name, end: at + 1, selfClosing: false, pieces }
        }
        const attribute = source.slice(nameFrom, at)
        pieces.push({ kind: 'text', text: attribute })
        if (source[at] !== '=') continue
        pieces.push({ kind: 'text', text: '=' })
        at += 1
        if (source[at] === '{') {
            const close = slotEnd(source, at)
            pieces.push(...slotOf(source.slice(at + 1, close), at + 1, 'any'))
            at = close + 1
            continue
        }
        const quote = source[at] as string
        if (quote === '"' || quote === "'") {
            const close = source.indexOf(quote, at + 1)
            const end = close === -1 ? source.length : close
            pieces.push({ kind: 'text', text: quote })
            // `generics="T extends { id: string }"` is a type, and its braces are no slot (34.13).
            if (attribute.toLowerCase() === 'generics')
                pieces.push({ kind: 'text', text: source.slice(at + 1, end) })
            else valuePieces(pieces, source, at + 1, end, quote)
            pieces.push({ kind: 'text', text: close === -1 ? '' : quote })
            at = close === -1 ? source.length : close + 1
            continue
        }
        const valueFrom = at
        while (
            at < source.length &&
            !isSpace(source[at] as string) &&
            source[at] !== '>'
        )
            at += 1
        valuePieces(pieces, source, valueFrom, at, 'unquoted')
    }
    return { name, end: at, selfClosing: false, pieces }
}

/** An attribute value's text and the slots in it, a slot that runs past the value kept as written. */
function valuePieces(
    pieces: Piece[],
    source: string,
    from: number,
    end: number,
    fit: Exclude<Fit, 'any'>,
): void {
    let textFrom = from
    let at = from
    while (at < end) {
        if (source[at] !== '{') {
            at += 1
            continue
        }
        const close = slotEnd(source, at)
        if (close >= end) break
        const raw = source.slice(at + 1, close)
        if (raw.trim() === '') {
            at = close + 1
            continue
        }
        if (at > textFrom)
            pieces.push({ kind: 'text', text: source.slice(textFrom, at) })
        pieces.push(...slotOf(raw, at + 1, fit))
        at = textFrom = close + 1
    }
    if (end > textFrom)
        pieces.push({ kind: 'text', text: source.slice(textFrom, end) })
}

/**
 * A block tag's pieces: `{#if}` and `{:else if}` with their condition an expression, `{#for}` with
 * its subject and its key, and every other block tag with its spacing tidied (32.64).
 */
function headerPieces(inner: string, at: number): Piece[] {
    const sigil = inner[0] as string
    const keyword = /^[#:]\s*([\w$]+)/.exec(inner)
    if (keyword === null) return [{ kind: 'text', text: `{${inner}}` }]
    const word = keyword[1] as string
    let rest = inner.slice(keyword[0].length)
    let restAt = at + keyword[0].length
    let head = `${sigil}${word}`
    const elseIf = word === 'else' ? ELSE_IF.exec(rest) : null
    if (elseIf !== null) {
        head = ':else if'
        rest = rest.slice(elseIf[0].length)
        restAt += elseIf[0].length
    }
    const subject = rest.trim()
    const subjectAt = restAt + leadingSpace(rest)
    if (subject === '') return [{ kind: 'text', text: `{${head}}` }]
    if (head === '#if' || head === ':else if')
        return [
            { kind: 'text', text: `{${head} ` },
            expressionOf(subject, subjectAt, 'any'),
            { kind: 'text', text: '}' },
        ]
    if (head === '#for') {
        const header = forPieces(subject, subjectAt)
        if (header !== undefined)
            return [
                { kind: 'text', text: '{#for ' },
                ...header,
                { kind: 'text', text: '}' },
            ]
    }
    return [{ kind: 'text', text: `{${head} ${subject}}` }]
}

/**
 * `{#for item, index of subject by key}` split where `forBlock` splits it — at the `of`, the `,`
 * and the `by` that stand at depth zero — or `undefined` where it has no `of`.
 */
function forPieces(header: string, at: number): Piece[] | undefined {
    const { of, comma, by } = forSeparators(header)
    if (of === undefined) return undefined
    const item = header.slice(0, (comma ?? of).start).trim()
    const index =
        comma === undefined ? '' : header.slice(comma.end, of.start).trim()
    const subject = header.slice(
        of.end,
        by === undefined ? header.length : by.start,
    )
    const pieces: Piece[] = [
        {
            kind: 'text',
            text: `${index === '' ? item : `${item}, ${index}`} of `,
        },
        trimmedExpression(subject, at + of.end),
    ]
    if (by !== undefined)
        pieces.push(
            { kind: 'text', text: ' by ' },
            trimmedExpression(header.slice(by.end), at + by.end),
        )
    return pieces
}

/** How much whitespace `text` opens with. */
function leadingSpace(text: string): number {
    return text.length - text.trimStart().length
}

/** An expression whose source `raw` starts at `rawAt`, written back as `raw` where it is refused. */
function expressionOf(raw: string, rawAt: number, fit: Fit): Expression {
    return {
        kind: 'expression',
        text: raw.trim(),
        raw,
        at: rawAt + leadingSpace(raw),
        fit,
    }
}

/** An expression its surrounding text spaces, so one refused is written back trimmed. */
function trimmedExpression(raw: string, rawAt: number): Expression {
    return expressionOf(raw.trim(), rawAt + leadingSpace(raw), 'any')
}

/** A slot's braces and the expression inside them, whose source `raw` starts at `rawAt`. */
function slotOf(raw: string, rawAt: number, fit: Fit): Piece[] {
    return [
        { kind: 'text', text: '{' },
        expressionOf(raw, rawAt, fit),
        { kind: 'text', text: '}' },
    ]
}

/**
 * Every expression of a file formatted in ONE call, each as the argument of a call of its own —
 * `__abide_3(expr)` — so `bun fmt` prints it as an expression; and the indent its options print,
 * read off a probe at the head of the batch. Where the batch is refused, each expression is asked
 * alone, so one that does not parse is the only one left as written.
 */
async function formatExpressions(
    path: string,
    expressions: Expression[],
): Promise<{ answers: Answer[]; unit: string }> {
    let batch = PROBE
    for (const [index, expression] of expressions.entries())
        batch += callOf(index, expression)
    const answer = await runFormatter(`${path}.ts`, batch)
    if (answer.text !== undefined) {
        const entries = entriesOf(answer.text)
        const unit = unitOf(entries.get('probe'))
        const answers: Answer[] = []
        for (const [index, expression] of expressions.entries())
            answers.push(answerOf(entries.get(String(index)), expression, unit))
        return { answers, unit }
    }
    const probe = await runFormatter(`${path}.ts`, PROBE)
    const unit = unitOf(
        probe.text === undefined
            ? undefined
            : entriesOf(probe.text).get('probe'),
    )
    const answers = await Promise.all(
        expressions.map(async (expression): Promise<Answer> => {
            const alone = await runFormatter(
                `${path}.ts`,
                callOf(0, expression),
            )
            if (alone.text !== undefined)
                return answerOf(
                    entriesOf(alone.text).get('0'),
                    expression,
                    unit,
                )
            // The call's own name opens the first line, and is not the expression's; an error past
            // its last line is where the parser ran out of it, at its end.
            const lines = expression.text.split('\n')
            const { message, line, column } = alone.error
            if (line > lines.length)
                return {
                    text: undefined,
                    error: {
                        message,
                        line: lines.length,
                        column: (lines[lines.length - 1] as string).length + 1,
                    },
                }
            const opening = line === 1 ? '__abide_0('.length : 0
            return {
                text: undefined,
                error: { message, line, column: Math.max(column - opening, 1) },
            }
        }),
    )
    return { answers, unit }
}

/** `expression` as the argument of the batch's call number `index`. */
function callOf(index: number, expression: Expression): string {
    return `__abide_${index}(${expression.text}\n)\n`
}

/** `expression` as `bun fmt` printed its call `entry`, or as it stands where none came back. */
function answerOf(
    entry: string | undefined,
    expression: Expression,
    unit: string,
): Answer {
    return {
        text: entry === undefined ? expression.text : unwrap(entry, unit),
        error: undefined,
    }
}

/** The batch `bun fmt` printed, split back into its calls by name. */
function entriesOf(printed: string): Map<string, string> {
    const entries = new Map<string, string>()
    let name: string | undefined
    let lines: string[] = []
    for (const line of printed.split('\n')) {
        const entry = ENTRY.exec(line)
        if (entry !== null) {
            if (name !== undefined) entries.set(name, lines.join('\n'))
            name = entry[1] as string
            lines = [line]
        } else lines.push(line)
    }
    if (name !== undefined) entries.set(name, lines.join('\n'))
    return entries
}

/** The indent `bun fmt` printed the probe's body at — the unit the markup is indented by. */
function unitOf(probe: string | undefined): string {
    const body = probe?.split('\n')[1]
    const unit =
        body === undefined
            ? ''
            : body.slice(0, body.length - body.trimStart().length)
    return unit === '' ? '  ' : unit
}

/**
 * One call's argument, as the expression it was: the call's name and its parentheses gone, and an
 * argument printed on lines of its own brought back out by one indent, its trailing comma dropped.
 */
function unwrap(entry: string, unit: string): string {
    let inner = entry.trimEnd().replace(ENTRY, '')
    if (inner.endsWith(';')) inner = inner.slice(0, -1)
    if (inner.endsWith(')')) inner = inner.slice(0, -1)
    if (!inner.startsWith('\n')) return inner.trimEnd()
    inner = shiftLines(
        inner.slice(1),
        (line) =>
            line.startsWith(unit) ? line.slice(unit.length) : line.trimStart(),
        'ts',
    ).trimEnd()
    return inner.endsWith(',') ? inner.slice(0, -1) : inner
}

/**
 * `code` with `shift` applied to every line after the first — in TypeScript, every one that starts
 * outside a template literal, since a line inside one is the string's own characters and moving it
 * changes the value.
 */
function shiftLines(
    code: string,
    shift: (line: string) => string,
    language: 'ts' | 'css',
): string {
    const insideTemplate: [number, number][] = []
    if (language === 'ts')
        for (const token of tokenize(code))
            if (
                token.kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
                token.kind === SyntaxKind.TemplateHead ||
                token.kind === SyntaxKind.TemplateMiddle ||
                token.kind === SyntaxKind.TemplateTail
            )
                insideTemplate.push([token.start, token.end])
    const lines = code.split('\n')
    let offset = (lines[0] as string).length + 1
    // The ranges are in source order and so are the lines, so one cursor walks both.
    let template = 0
    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index] as string
        while (
            template < insideTemplate.length &&
            (insideTemplate[template] as [number, number])[1] <= offset
        )
            template += 1
        const range = insideTemplate[template]
        if (range === undefined || offset <= range[0])
            lines[index] = shift(line)
        offset += line.length + 1
    }
    return lines.join('\n')
}

/** `code` with every line after the first moved right by `indent`, a blank line left blank. */
function indented(
    code: string,
    indent: string,
    language: 'ts' | 'css',
): string {
    if (indent === '') return code
    return shiftLines(
        code,
        (line) => (line === '' ? line : indent + line),
        language,
    )
}

/**
 * The pieces written back out: each break re-indented by the nesting where it lands, and each
 * piece of code as `bun fmt` printed it where it fits where it stands.
 */
function emit(
    pieces: Piece[],
    formatted: Map<Piece, string>,
    unit: string,
): string {
    let out = ''
    let depth = 0
    let pending: Extract<Piece, { kind: 'break' }> | undefined
    // Whether the pending break stands at an end of a body: after what opened it, or before what
    // closes it — where 33.17 and 33.18 drop a run of either kind.
    let opened = true
    let closing = false

    const lineIndent = (): string => {
        const line = out.slice(out.lastIndexOf('\n') + 1)
        return line.slice(0, line.length - line.trimStart().length)
    }
    const resolve = (): void => {
        if (pending === undefined) return
        const level = pending.place === 'tag' ? depth + 1 : depth
        const newlines = Math.min(pending.text.split('\n').length - 1, 2)
        const written =
            out === '' ? '' : '\n'.repeat(newlines) + unit.repeat(level)
        // 38.127 — a run that is a whole text node between two nodes keeps its kind: a newline
        // alone stays a newline alone (33.17), and one carrying indentation keeps carrying some.
        const keepsKind =
            !pending.alone ||
            opened ||
            closing ||
            /[ \t]/.test(pending.text) === /[ \t]/.test(written)
        out += keepsKind ? written : pending.text
        pending = undefined
    }
    const printable = (): void => {
        resolve()
        opened = false
        closing = false
    }

    for (const piece of pieces) {
        switch (piece.kind) {
            case 'open':
                depth += 1
                opened = true
                continue
            case 'close':
                depth = Math.max(depth - 1, 0)
                closing = true
                continue
            case 'break':
                pending = piece
                continue
            case 'text':
                printable()
                out += piece.text
                continue
            case 'expression': {
                printable()
                const printed = formatted.get(piece)
                const fits =
                    printed !== undefined &&
                    (piece.fit === 'any' ||
                        (piece.fit === 'unquoted'
                            ? !/[\s>"'`=<]/.test(printed)
                            : !printed.includes('\n') &&
                              !printed.includes(piece.fit)))
                out += fits ? indented(printed, lineIndent(), 'ts') : piece.raw
                continue
            }
            case 'code': {
                printable()
                const printed = formatted.get(piece)
                if (printed === undefined) {
                    out += piece.text + piece.close
                    continue
                }
                const indent = lineIndent()
                const body = printed.trim()
                out +=
                    body === ''
                        ? piece.close
                        : `\n${indent}${indented(body, indent, piece.language)}\n${indent}${piece.close}`
                continue
            }
        }
    }
    return `${out.trimEnd()}\n`
}

/** What `bun fmt` prints for `text` read as the file at `path`, or why it refused. */
async function runFormatter(path: string, text: string): Promise<Answer> {
    // `--no-script`: a project whose `fmt` script runs `abide format` would otherwise run this again.
    const child = Bun.spawn(
        [process.execPath, 'fmt', '--no-script', `--stdin-filepath=${path}`],
        {
            cwd: dirname(path),
            stdin: new Blob([text]),
            stdout: 'pipe',
            stderr: 'pipe',
        },
    )
    const [printed, complaint, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ])
    if (code === 0) return { text: printed, error: undefined }
    const message =
        /error: (.*)/.exec(complaint)?.[1] ??
        (complaint.trim() || `bun fmt exited ${code}`)
    const where = /:(\d+):(\d+)\s*$/m.exec(complaint)
    return {
        text: undefined,
        error: {
            message,
            line: where === null ? 1 : Number(where[1]),
            column: where === null ? 1 : Number(where[2]),
        },
    }
}
