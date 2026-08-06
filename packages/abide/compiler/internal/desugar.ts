// Sources are read and written by NAME.
//
// SPEC's word is `source` — `state`, `memo` or `channel`, anything whose call is a reactive read —
// and `cell` is the narrower one: a source you can also `set` and `await`. This file deals in
// sources, because what it rewrites is READS, and every source has those.
//
//   {source}          the identifier IS the expression — left alone, because `unwrap` in
//                     `$shared/internal/slots.ts` already reads a slot's source one step further,
//                     and because handing the SOURCE over is what `bind:value={x}` and a component
//                     prop need. Naming one alone hands it over; using it in an expression reads it.
//                     That rule is decided by the caller, which does not call in here for a lone
//                     identifier.
//   {source + 1}      a read      -> source() + 1
//   source = v        a write     -> source.set(v)
//   source += v       both        -> source.set(source.peek() + v)     peek: a write must not subscribe
//   source()          untouched   -> an identifier in callee position is already an explicit read
//   source.set(v)     untouched   -> the shared surface in SPEC is reserved; every OTHER property is
//                                    the value's own, so `state('abc').length` is `source().length`
//
// What counts as a source is decided SYNTACTICALLY — no type-checker in the emit path, so the
// JavaScript lane compiles too, and emitting a file never costs a program-wide check. The cost of
// that choice is stated where it bites: an imported source cannot be seen, so it keeps the explicit
// spelling.
//
// Shadowing is tracked, because it is the one way this can be silently WRONG: rewriting
// `items.map((count) => count * 2)` when an outer `count` source exists produces working-looking
// code that reads the wrong thing. Frames are keyed on nesting depth rather than on a parse tree —
// there is no parser here — and every construct that binds a name inside a template is modelled.

import { SyntaxKind } from 'typescript/unstable/ast'
import { Lexer, SyntaxError_, type Token } from './lex.ts'

/**
 * The verbs every source carries (SPEC, "The shared surface"). Reserved: `x.set` is the verb, and
 * anything else after the dot belongs to the value the source holds.
 */
const SOURCE_SURFACE = new Set([
    'set',
    'peek',
    'invalidate',
    'refresh',
    'publish',
    'chunks',
    'pending',
    'refreshing',
    'settled',
    'done',
    'streaming',
    'error',
    'isError',
    'watch',
    'then',
])

/** The constructors whose result is a SOURCE, so `const x = state(…)` makes `x` reactive. */
export const REACTIVE_CONSTRUCTORS = new Set(['state', 'memo', 'channel'])

/** Prop types that mean "this prop IS a source", read off the declared `Args` member. */
export const REACTIVE_TYPES = new Set([
    'State',
    'Memo',
    'MemoHandle',
    'Cell',
    'Channel',
    'KeyedMemo',
    'RoomChannel',
])

const COMPOUND_ASSIGN = new Map<SyntaxKind, string>([
    [SyntaxKind.PlusEqualsToken, '+'],
    [SyntaxKind.MinusEqualsToken, '-'],
    [SyntaxKind.AsteriskEqualsToken, '*'],
    [SyntaxKind.SlashEqualsToken, '/'],
    [SyntaxKind.PercentEqualsToken, '%'],
    [SyntaxKind.AsteriskAsteriskEqualsToken, '**'],
    [SyntaxKind.AmpersandEqualsToken, '&'],
    [SyntaxKind.BarEqualsToken, '|'],
    [SyntaxKind.CaretEqualsToken, '^'],
    [SyntaxKind.LessThanLessThanEqualsToken, '<<'],
    [SyntaxKind.GreaterThanGreaterThanEqualsToken, '>>'],
    [SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, '>>>'],
])

// `??=`, `&&=` and `||=` short-circuit, so they are not `set(peek() op v)` — the write must not
// happen at all when the test fails. Handled separately below.
const LOGICAL_ASSIGN = new Map<SyntaxKind, string>([
    [SyntaxKind.QuestionQuestionEqualsToken, '??'],
    [SyntaxKind.AmpersandAmpersandEqualsToken, '&&'],
    [SyntaxKind.BarBarEqualsToken, '||'],
])

export const OPENERS = new Set<SyntaxKind>([
    SyntaxKind.OpenParenToken,
    SyntaxKind.OpenBracketToken,
    SyntaxKind.OpenBraceToken,
    SyntaxKind.TemplateHead,
])
export const CLOSERS = new Set<SyntaxKind>([
    SyntaxKind.CloseParenToken,
    SyntaxKind.CloseBracketToken,
    SyntaxKind.CloseBraceToken,
    SyntaxKind.TemplateTail,
])

const DECLARERS = new Set<SyntaxKind>([SyntaxKind.ConstKeyword, SyntaxKind.LetKeyword, SyntaxKind.VarKeyword])

interface Edit {
    start: number
    end: number
    replacement: string
}

/**
 * A read the walk performed, so a caller can hoist it.
 *
 * `key` is the read's own source text with whitespace collapsed — the same read written the same way
 * in two places matches, which is what lets a `{#if}` condition and its body share one const.
 */
export interface Read {
    key: string
    start: number
    end: number
    keyed: boolean
}

/** A binding introduced inside the region, live until nesting falls back past `nesting`. */
interface Frame {
    nesting: number
    /** An expression-bodied arrow also ends at a `,` on its own level. */
    endsOnComma: boolean
    /**
     * Token index the frame dies at, exclusive. Only a `for` head needs it: its binding covers the
     * head AND the body, and nesting dips back out between the two, so a depth rule alone retires it
     * one token before the body that uses it.
     */
    endIndex: number
    names: Set<string>
}

const NO_END = Number.MAX_SAFE_INTEGER
const EMPTY: ReadonlySet<string> = new Set()
const NO_HOIST: ReadonlyMap<string, string> = new Map()

interface Cursor {
    tokens: Token[]
    /** Nesting depth AFTER each token, over `(` `[` `{` alike. */
    nesting: number[]
}

function tokenize(source: string, from: number, to: number): Cursor {
    const lexer = new Lexer(source, from)
    const tokens: Token[] = []
    const nesting: number[] = []
    let level = 0
    for (;;) {
        const token = lexer.next()
        if (token === null || token.start >= to) break
        if (OPENERS.has(token.kind)) level++
        else if (CLOSERS.has(token.kind)) level--
        // A TemplateMiddle both closes and reopens a substitution, so it nets out.
        tokens.push(token)
        nesting.push(level)
    }
    return { tokens, nesting }
}

/**
 * The token indices a binding pattern introduces. An identifier followed by `:` is an object-pattern
 * KEY, not a binding — `{ a: b }` binds `b`. An identifier after `.` is a property.
 */
function boundNames(cursor: Cursor, from: number, to: number): number[] {
    const indices: number[] = []
    for (let i = from; i < to; i++) {
        const token = cursor.tokens[i] as Token
        if (token.kind !== SyntaxKind.Identifier) continue
        const previous = cursor.tokens[i - 1]
        if (previous?.kind === SyntaxKind.DotToken || previous?.kind === SyntaxKind.QuestionDotToken) continue
        if (cursor.tokens[i + 1]?.kind === SyntaxKind.ColonToken) continue
        indices.push(i)
    }
    return indices
}

/**
 * Walk back from a `)` to its `(`. Nesting is recorded AFTER each token, so the opener sits one
 * level above its closer — matching on the closer's own level finds an enclosing paren instead.
 */
function matchBackwards(cursor: Cursor, closeIndex: number): number {
    const target = (cursor.nesting[closeIndex] as number) + 1
    for (let i = closeIndex - 1; i >= 0; i--) {
        if ((cursor.nesting[i] as number) === target && OPENERS.has((cursor.tokens[i] as Token).kind)) {
            return i
        }
    }
    return -1
}

/** The token index a `for` head's binding stops covering: past the loop body, not past the head. */
function forStatementEnd(cursor: Cursor, declarerIndex: number, level: number): number {
    let close = declarerIndex + 1
    while (close < cursor.tokens.length && (cursor.nesting[close] as number) >= level) close++
    const body = cursor.tokens[close + 1]
    if (body?.kind !== SyntaxKind.OpenBraceToken) return cursor.tokens.length
    const outer = cursor.nesting[close] as number
    let end = close + 2
    while (end < cursor.tokens.length && (cursor.nesting[end] as number) > outer) end++
    return end + 1
}

/**
 * Rewrite cell reads and writes across `[from, to)`. `reactive` is the set of names known to hold a
 * cell at entry; bindings introduced inside the region shadow them.
 */
export interface DesugarOptions {
    /** True for a template expression, false for a `<script>` body — see `inObjectLiteral`. */
    expression?: boolean
    /**
     * Names whose CALL is the cell rather than the name — a keyed `memo`. `m(args)` selects the slot
     * and hands back its handle, so `m(args).pages` is a read of the handle exactly the way `x.pages`
     * is a read of `x`.
     */
    keyed?: ReadonlySet<string>
    /**
     * Leave the outermost read alone when it is the WHOLE region, so the cell itself is handed over.
     * The caller decides: a child slot and a prop hold, a class toggle reads.
     */
    hold?: boolean
    /**
     * Reads already performed into a local, by `key`. A read found here becomes that local instead of
     * calling again — which is what makes narrowing work: TypeScript narrows a `const`, and never a
     * call.
     */
    hoisted?: ReadonlyMap<string, string>
}

export function desugar(
    source: string,
    from: number,
    to: number,
    reactive: ReadonlySet<string>,
    options: DesugarOptions = {},
): { text: string; reads: Read[] } {
    const expression = options.expression ?? true
    const keyedNames = options.keyed ?? EMPTY
    const hoisted = options.hoisted ?? NO_HOIST
    const reads: Read[] = []
    if (reactive.size === 0 && keyedNames.size === 0) {
        return { text: source.slice(from, to), reads }
    }

    const cursor = tokenize(source, from, to)
    const { tokens, nesting } = cursor
    const edits: Edit[] = []

    // Pass one collects the bindings, because a parameter is written BEFORE the scope it opens:
    // by the time `=>` says `(count) => …` bound `count`, a single-pass walk has already rewritten
    // it as a read. `binding` marks the occurrences that name something rather than use it, and
    // `opens` says which frame becomes live at which token.
    const binding = new Set<number>()
    const opens = new Map<number, Frame>()

    const bind = (
        indices: number[],
        at: number,
        level: number,
        endsOnComma: boolean,
        endIndex = NO_END,
    ): void => {
        const names = new Set<string>()
        for (const index of indices) {
            binding.add(index)
            names.add((tokens[index] as Token).text)
        }
        opens.set(at, { nesting: level, endsOnComma, endIndex, names })
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        const level = nesting[i] as number

        if (token.kind === SyntaxKind.EqualsGreaterThanToken) {
            const previous = tokens[i - 1]
            let indices: number[] = []
            if (previous?.kind === SyntaxKind.CloseParenToken) {
                const open = matchBackwards(cursor, i - 1)
                if (open >= 0) indices = boundNames(cursor, open + 1, i - 1)
            } else if (previous?.kind === SyntaxKind.Identifier) {
                indices = [i - 1]
            }
            const block = tokens[i + 1]?.kind === SyntaxKind.OpenBraceToken
            bind(indices, i, block ? level + 1 : level, !block)
            continue
        }

        if (DECLARERS.has(token.kind) || token.kind === SyntaxKind.CatchKeyword) {
            // Up to the initialiser, the `of`/`in` of a for-head, or the end of the statement.
            let end = i + 1
            while (end < tokens.length) {
                const kind = (tokens[end] as Token).kind
                const at = nesting[end] as number
                if (at < level) break
                if (
                    at === level &&
                    (kind === SyntaxKind.EqualsToken ||
                        kind === SyntaxKind.SemicolonToken ||
                        kind === SyntaxKind.OfKeyword ||
                        kind === SyntaxKind.InKeyword)
                ) {
                    break
                }
                end++
            }
            const names = boundNames(cursor, i + 1, end)

            // `const count = state(0)` DECLARES the cell rather than hiding one, so it must not
            // shadow: treating it like any other binding makes the name reactive everywhere except
            // the body it was introduced in, which is every use of it. `state.shared(key, …)` is
            // the same declaration with an address in front of the value.
            const maker = tokens[end + 1]?.text ?? ''
            const declares =
                (REACTIVE_CONSTRUCTORS.has(maker) && tokens[end + 2]?.kind === SyntaxKind.OpenParenToken) ||
                (maker === 'state' &&
                    tokens[end + 2]?.kind === SyntaxKind.DotToken &&
                    tokens[end + 3]?.text === 'shared' &&
                    tokens[end + 4]?.kind === SyntaxKind.OpenParenToken)
            if (declares) {
                for (const index of names) binding.add(index)
                continue
            }

            // `for (const x of …)` binds across the head AND the body; everything else is scoped by
            // the block it sits in, which the nesting rule already retires correctly.
            const head =
                tokens[i - 1]?.kind === SyntaxKind.OpenParenToken &&
                tokens[i - 2]?.kind === SyntaxKind.ForKeyword
            bind(names, i, head ? -1 : level, false, head ? forStatementEnd(cursor, i, level) : NO_END)
            continue
        }

        if (token.kind === SyntaxKind.FunctionKeyword) {
            // The name binds outside and the parameters inside; both shadow, so take them together.
            let open = i + 1
            while (open < tokens.length && (tokens[open] as Token).kind !== SyntaxKind.OpenParenToken) open++
            const close = open < tokens.length ? matchForwards(cursor, open) : -1
            bind(boundNames(cursor, i + 1, close < 0 ? open : close), i, level, false)
        }
    }

    const frames: Frame[] = []
    const shadowed = (name: string): boolean => {
        for (let f = frames.length - 1; f >= 0; f--) {
            if ((frames[f] as Frame).names.has(name)) return true
        }
        return false
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        const level = nesting[i] as number

        // Retire frames the walk has left.
        while (frames.length > 0) {
            const frame = frames[frames.length - 1] as Frame
            const left = level < frame.nesting || i >= frame.endIndex
            const comma = frame.endsOnComma && level === frame.nesting && token.kind === SyntaxKind.CommaToken
            if (!left && !comma) break
            frames.pop()
        }

        const opened = opens.get(i)
        if (opened !== undefined) frames.push(opened)

        if (token.kind !== SyntaxKind.Identifier || binding.has(i)) continue
        const name = token.text
        const previous = tokens[i - 1]
        const next = tokens[i + 1]

        // A keyed memo: the CALL is the cell, so `m(args)` is read wherever `x` would be. The `()`
        // goes after the call's own closing paren, and everything the identifier rule says applies
        // unchanged — callee position is an explicit read, the cell surface is reserved, and the
        // whole region held alone hands the handle over.
        if (
            keyedNames.has(name) &&
            !shadowed(name) &&
            next?.kind === SyntaxKind.OpenParenToken &&
            previous?.kind !== SyntaxKind.DotToken &&
            previous?.kind !== SyntaxKind.QuestionDotToken
        ) {
            const close = matchForwards(cursor, i + 1)
            if (close < 0) continue
            const after = tokens[close + 1]
            const member = tokens[close + 2]
            const explicit = after?.kind === SyntaxKind.OpenParenToken
            const verb =
                (after?.kind === SyntaxKind.DotToken || after?.kind === SyntaxKind.QuestionDotToken) &&
                member !== undefined &&
                SOURCE_SURFACE.has(member.text)
            if (!explicit && !verb) {
                const end = (tokens[close] as Token).end
                const key = source.slice(token.start, end).replace(/\s+/g, ' ')
                reads.push({ key, start: token.start, end, keyed: true })
                const local = hoisted.get(key)
                if (local !== undefined) {
                    // A hoisted read wins over holding the handle, even when the call IS the whole
                    // expression: the enclosing condition already subscribed to it, so handing the
                    // handle over here would only subscribe a second time for the same change.
                    //
                    // The local holds the whole read, arguments included, so the walk skips the
                    // call's own tokens — rewriting inside a span that has been replaced produces
                    // overlapping edits, which is garbage rather than a wrong answer.
                    edits.push({ start: token.start, end, replacement: local })
                    i = close
                } else if (
                    // Held alone as the whole region, the handle itself is what the caller wants.
                    options.hold !== true ||
                    token.start !== (tokens[0] as Token).start ||
                    after !== undefined
                ) {
                    edits.push({ start: end, end, replacement: '()' })
                }
            }
            continue
        }

        if (!reactive.has(name) || shadowed(name)) continue

        // `.source` / `?.source` — a property, not this binding.
        if (previous?.kind === SyntaxKind.DotToken || previous?.kind === SyntaxKind.QuestionDotToken) continue
        // `{ source: … }` — an object literal key.
        if (next?.kind === SyntaxKind.ColonToken) continue
        // `source(…)` — the author wrote the read.
        if (next?.kind === SyntaxKind.OpenParenToken) continue
        // `source.set(…)` and the rest of the reserved surface. Matched on TEXT, not kind: `set` and
        // `get` scan as contextual keywords rather than identifiers.
        const member = tokens[i + 2]
        if (
            (next?.kind === SyntaxKind.DotToken || next?.kind === SyntaxKind.QuestionDotToken) &&
            member !== undefined &&
            SOURCE_SURFACE.has(member.text)
        ) {
            continue
        }

        // `source++` / `source--`, and the prefix forms.
        const update =
            next?.kind === SyntaxKind.PlusPlusToken || next?.kind === SyntaxKind.MinusMinusToken
                ? next
                : previous?.kind === SyntaxKind.PlusPlusToken || previous?.kind === SyntaxKind.MinusMinusToken
                  ? previous
                  : undefined
        if (update !== undefined) {
            const operator = update.kind === SyntaxKind.PlusPlusToken ? '+' : '-'
            const start = Math.min(token.start, update.start)
            const end = Math.max(token.end, update.end)
            edits.push({
                start,
                end,
                replacement: `${name}.set(${name}.peek() ${operator} 1)`,
            })
            if (update === next) i++
            continue
        }

        // A write is emitted as a PAIR of edits — an opener over `name =` and a `)` at the end of the
        // right-hand side — rather than as one edit carrying a slice of the original text. Slicing
        // would freeze the RHS before it is itself desugared, so `count = count + 1` would keep the
        // raw `count` on the right. Leaving the RHS to the ordinary walk composes instead.
        const compound = next === undefined ? undefined : COMPOUND_ASSIGN.get(next.kind)
        const logical = next === undefined ? undefined : LOGICAL_ASSIGN.get(next.kind)
        if (
            next !== undefined &&
            (next.kind === SyntaxKind.EqualsToken || compound !== undefined || logical !== undefined)
        ) {
            const rhs = assignmentEnd(cursor, i + 2, level, to)
            const opener =
                compound !== undefined
                    ? `${name}.set(${name}.peek() ${compound} `
                    : logical !== undefined
                      ? // Short-circuiting: the write must not happen at all when the test fails, so
                        // the operator survives into the emitted code instead of being flattened.
                        `void (${name}.peek() ${logical} ${name}.set(`
                      : `${name}.set(`
            // The opener swallows the gap after `=` too, so the emitted call has no stray space.
            edits.push({ start: token.start, end: rhs.start, replacement: opener })
            edits.push({ start: rhs.end, end: rhs.end, replacement: logical !== undefined ? '))' : ')' })
            continue
        }

        // `{ source }` — object shorthand, which has to grow its key to stay an object.
        const shorthand =
            (previous?.kind === SyntaxKind.OpenBraceToken || previous?.kind === SyntaxKind.CommaToken) &&
            (next?.kind === SyntaxKind.CommaToken || next?.kind === SyntaxKind.CloseBraceToken) &&
            inObjectLiteral(cursor, i, expression)
        reads.push({ key: name, start: token.start, end: token.end, keyed: false })
        const local = hoisted.get(name)
        const read = local ?? `${name}()`
        edits.push({
            start: token.start,
            end: token.end,
            replacement: shorthand ? `${name}: ${read}` : read,
        })
    }

    return { text: apply(source, from, to, edits), reads }
}

function matchForwards(cursor: Cursor, openIndex: number): number {
    const target = cursor.nesting[openIndex] as number
    for (let i = openIndex + 1; i < cursor.tokens.length; i++) {
        if ((cursor.nesting[i] as number) === target - 1) return i
    }
    return -1
}

/**
 * Where the right-hand side of an assignment ends: the first `,` `;` or closer at or below the
 * assignment's own level.
 */
function assignmentEnd(
    cursor: Cursor,
    from: number,
    level: number,
    limit: number,
): { start: number; end: number } {
    const first = cursor.tokens[from]
    if (first === undefined) {
        throw new SyntaxError_('abide: assignment with nothing on the right', limit)
    }
    let i = from
    while (i < cursor.tokens.length) {
        const token = cursor.tokens[i] as Token
        const at = cursor.nesting[i] as number
        if (at < level) break
        if (
            at === level &&
            (token.kind === SyntaxKind.CommaToken || token.kind === SyntaxKind.SemicolonToken)
        ) {
            break
        }
        i++
    }
    const last = cursor.tokens[i - 1] as Token
    return { start: first.start, end: last.end }
}

/** Is the brace enclosing token `i` an object literal rather than a block? */
function inObjectLiteral(cursor: Cursor, i: number, expression: boolean): boolean {
    const level = cursor.nesting[i] as number
    for (let back = i - 1; back >= 0; back--) {
        if ((cursor.nesting[back] as number) !== level) continue
        const token = cursor.tokens[back] as Token
        if (token.kind !== SyntaxKind.OpenBraceToken) continue
        // A `{` that follows `=>`, `)`, `;` or nothing opens a BLOCK; after `(`, `,`, `=`, `:` or
        // `return` it opens an object literal. With nothing before it, the region's own kind
        // decides: a template expression is an expression, a `<script>` body is statements.
        const before = cursor.tokens[back - 1]
        if (before === undefined) return expression
        return (
            before.kind === SyntaxKind.OpenParenToken ||
            before.kind === SyntaxKind.CommaToken ||
            before.kind === SyntaxKind.EqualsToken ||
            before.kind === SyntaxKind.ColonToken ||
            before.kind === SyntaxKind.OpenBracketToken ||
            before.kind === SyntaxKind.ReturnKeyword
        )
    }
    return false
}

// Edits are produced in token order, but a write emits its closing `)` at a position the walk has
// not reached yet — so they are ordered here rather than at the push.
function apply(source: string, from: number, to: number, edits: Edit[]): string {
    if (edits.length === 0) return source.slice(from, to)
    edits.sort((a, b) => a.start - b.start || a.end - b.end)
    let out = ''
    let cursor = from
    for (const edit of edits) {
        out += source.slice(cursor, edit.start)
        out += edit.replacement
        cursor = Math.max(cursor, edit.end)
    }
    return out + source.slice(cursor, to)
}
