// Sources are read and written by NAME.
//
// SPEC's word is `source` — `state`, `memo` or `channel`, anything whose call is a reactive read —
// and `cell` is the narrower one: a source you can also `set` and `await`. This file deals in
// sources, because what it rewrites is READS, and every source has those.
//
//   {source}          the identifier IS the expression — left alone, because `unwrap` in
//                     `#shared/internal/slots.ts` already reads a slot's source one step further,
//                     and because handing the SOURCE over is what `bind:value={x}` and a component
//                     prop need. Naming one alone hands it over; using it in an expression reads it.
//                     That rule is decided by the caller, which does not call in here for a lone
//                     identifier.
//   {source + 1}      a read      -> source() + 1
//   source = v        a write     -> source.set(v)
//   source += v       both        -> source.set(source.peek() + v)     peek: a write must not subscribe
//   source = source+v the same    -> source.set(source.peek() + v)     the TARGET on its own RHS peeks
//   source()          untouched   -> an identifier in callee position is already an explicit read
//   await source      untouched   -> the await IS the read, and `then` is already reserved below
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
import { ENDS_EXPRESSION, Lexer, SyntaxError_, type Token } from './lex.ts'
// The cast keywords THEMSELVES: `types.ts` marks what FOLLOWS one, and here the keyword is
// punctuation on a name to step over.
import { closeAngle, inObjectLiteral, TYPE_CAST_KEYWORDS, typeRegions } from './types.ts'

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
    'subscribe',
    'tail',
    'dispose',
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

/**
 * Whether the token in front of a source is `await`, which HANDS THE SOURCE OVER rather than reading it.
 *
 * `then` is already on the surface above, so `x.then(…)` reaches the handle — and `await x` is the same
 * call written the way anybody writes it. Read as a value instead, the await resolves whatever the cell
 * held at that instant, which for a load still in flight is `undefined`: `await rename({ id })` emitted
 * `await rename({ id })()` and a documented rung threw on `undefined.name` in a browser while every gate
 * in the repo stayed green.
 *
 * Matched on TEXT for `SOURCE_SURFACE`'s reason — `await` is contextual, so it scans as an identifier in
 * a lane the scanner does not know is async. Nothing else can sit here: `await` is reserved inside a
 * module, so an identifier preceding another identifier is not a name an author could have bound.
 */
function awaited(previous: Token | undefined): boolean {
    return previous !== undefined && previous.text === 'await'
}

/**
 * Which loop does the `(` at `at` open, if it opens one at all?
 *
 * `for (` and `for await (` differ by exactly one token, so both the head's BINDING and its
 * iterable's sugar ask this one question — spelled twice, the two disagreed about `for await` and a
 * head bound its name without shadowing the body that uses it.
 */
function forHeadAt(tokens: Token[], at: number): 'plain' | 'await' | null {
    if (tokens[at]?.kind !== SyntaxKind.OpenParenToken) return null
    if (awaited(tokens[at - 1])) {
        return tokens[at - 2]?.kind === SyntaxKind.ForKeyword ? 'await' : null
    }
    return tokens[at - 1]?.kind === SyntaxKind.ForKeyword ? 'plain' : null
}

/**
 * Is this identifier the WHOLE iterable of a `for await` head?
 *
 * `for await` iterates the cell itself — a slot's async iterator is its transcript cursor, which is
 * what makes a streamed read spell the same on both sides. Reading it first hands the loop the latest
 * CHUNK, a value and not iterable at all.
 *
 * The whole of it, because only then is the cell what the loop wants: `for await (const r of
 * rows.map(load))` iterates an array the cell HOLDS, so that one is an ordinary read and suppressing
 * it hands `.map` to the handle. A synchronous `for … of` is untouched for the same reason.
 *
 * Walked back to the head's own `(` because `of` is the only token the two loops share.
 */
function asyncIterated(tokens: Token[], at: number, end: number): boolean {
    if (tokens[at - 1]?.kind !== SyntaxKind.OfKeyword) return false
    // Nothing between the name and the head's `)`, or it is an expression the cell is only part of.
    if (tokens[end + 1]?.kind !== SyntaxKind.CloseParenToken) return false
    for (let i = at - 2; i >= 0; i--) {
        if ((tokens[i] as Token).kind !== SyntaxKind.OpenParenToken) continue
        return forHeadAt(tokens, i) === 'await'
    }
    return false
}

/** The constructors whose result is a SOURCE, so `const x = state(…)` makes `x` reactive. */
export const REACTIVE_CONSTRUCTORS = new Set(['state', 'memo', 'channel'])

/**
 * Prop types that mean "this prop IS a source", read off the declared `Args` member — and which of
 * the two kinds each one is, so the emit reads one table rather than a special case beside it. A
 * `keyed` type's CALL is the source: a keyed memo selects a slot, a room channel selects a room.
 */
export const REACTIVE_TYPES = new Map<string, 'cell' | 'keyed'>([
    ['State', 'cell'],
    ['Memo', 'cell'],
    ['MemoHandle', 'cell'],
    ['Cell', 'cell'],
    ['Channel', 'cell'],
    ['KeyedMemo', 'keyed'],
    ['KeyedChannel', 'keyed'],
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
/** No hoisted locals — the default here, and what `emit` hands a `cell` position. Shared, never written. */
export const NO_HOIST: ReadonlyMap<string, string> = new Map()

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
 *
 * That key rule is why the colon is checked against the pattern's DEPTH rather than on its own, and
 * the difference is a whole class of silent miscompiles. Every caller here — a declarator, a
 * parameter list, a `catch` — is a place a TYPE ANNOTATION is legal, and an annotated binding wears
 * the same colon a key does: `const showing: number[] = []` and `(showing: number[]) => …` both name
 * `showing` and both were skipped, so neither ever shadowed an outer cell of that name. What the
 * emitter then produced was `showing()` over a plain array — a call on the LOCAL, in a file where
 * nothing near it mentions a cell. It cost a page: a memo named for a local one function away
 * compiled to `showing().push(row)` and took every control on `/bench` down with it.
 *
 * A key only exists inside a `{ }` or `[ ]`, so depth is what tells the two apart: deeper than the
 * pattern's own level is a destructuring key, and at that level it is a name with a type on it.
 */
function boundNames(cursor: Cursor, from: number, to: number, inType: Uint8Array): number[] {
    const indices: number[] = []
    // The level the pattern itself sits at. A destructuring key is always deeper than this, because
    // it is inside the brace or bracket that makes it a pattern at all.
    const base = cursor.nesting[from] as number
    for (let i = from; i < to; i++) {
        // `const a: typeof n = n` names `a` and mentions `n`. Without this the annotation's `n` was
        // collected as a binding, which shadowed the cell for the rest of the block. Required rather
        // than optional so a new call site cannot skip the mask and reintroduce that.
        if (inType[i] === 1) continue
        const token = cursor.tokens[i] as Token
        if (token.kind !== SyntaxKind.Identifier) continue
        const previous = cursor.tokens[i - 1]
        if (previous?.kind === SyntaxKind.DotToken || previous?.kind === SyntaxKind.QuestionDotToken) continue
        if (cursor.tokens[i + 1]?.kind === SyntaxKind.ColonToken && (cursor.nesting[i] as number) > base) {
            continue
        }
        indices.push(i)
    }
    return indices
}

/**
 * What a DETACHED parameter list binds — a `{#component Name(…)}` header, which `emit` reads as a
 * string because the parse node carries it as one.
 *
 * The same walk pass one makes over a `(…) =>`, so the two cannot disagree about a list. `emit`
 * answered it with `/([A-Za-z_$][\w$]*)/g`, which cannot see a type: every identifier in an
 * ANNOTATION came back as a binding, so `Row(props: { count: number })` shadowed an outer `count`
 * cell and the body's `{count + 1}` emitted an unthunked read — right value on the first render, and
 * no wake after it.
 *
 * Parenthesised before tokenizing because `boundNames` reads DEPTH to tell a destructuring key from
 * an annotated name, and the list's own level is the one the parens make.
 */
export function parameterNames(parameters: string): string[] {
    const wrapped = `(${parameters})`
    const cursor = tokenize(wrapped, 0, wrapped.length)
    const tokens = cursor.tokens
    if (tokens.length < 2) return []
    const { marks } = typeRegions(tokens, cursor.nesting, true)
    const names: string[] = []
    for (const index of boundNames(cursor, 1, tokens.length - 1, marks)) {
        names.push((tokens[index] as Token).text)
    }
    return names
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
    keyed: ReadonlySet<string>
    /**
     * Leave the outermost read alone when it is the WHOLE region, so the cell itself is handed over.
     * The caller decides: a child slot and a prop hold, a class toggle reads.
     *
     * WHICH held position it is decides exactly one case — a name that is the whole region AND has a
     * hoisted local under it:
     *
     *   `slot`  the local wins. `unwrap` reads a slot's cell one step further, so the two spellings
     *           render the same thing and the local is one subscription rather than two.
     *   `cell`  holding wins. A prop, a `bind:` and an `&ref` need the CELL, and a local is a value —
     *           a child handed one has nothing left to subscribe to, which is dead on the first write
     *           rather than merely coarser.
     *
     * Everything that is NOT the whole region — a member path, a call, an expression — takes the
     * local in both, because reaching the member has already read the cell and the enclosing
     * condition is already subscribed to it.
     */
    hold?: 'slot' | 'cell' | undefined
    /**
     * Reads already performed into a local, by `key`. A read found here becomes that local instead of
     * calling again — which is what makes narrowing work: TypeScript narrows a `const`, and never a
     * call.
     */
    hoisted?: ReadonlyMap<string, string>
    /**
     * The region RUNS ONCE — a component's own `<script module>` and `<script>`, whose statements are
     * the setup rather than anything the graph re-runs.
     *
     * A read there emits `peek()` instead of `()`, and gets the honest `T | undefined` from it: the
     * signal a cold read throws only helps where re-running is the recovery, and nobody would run
     * setup a second time. A branch-local `<script>` is NOT this — it lives inside the branch's own
     * thunk, which is re-run — so it passes nothing and keeps the reading spelling.
     *
     * Only at STATEMENT level. A function body in a `<script>` may be a `memo` or `watch` body, and
     * nothing syntactic separates one from an event handler, so it is treated as re-runnable — the
     * conservative arm, since the other way round silently unsubscribes a derivation.
     */
    once?: boolean
}

/**
 * Where `names` are CALLED as statements in `source` — not inside any function body.
 *
 * `watch` is what needs this and a cell does not: a cell is recognised by its BINDING, and an effect
 * has none to recognise. What separates `watch(…)` at module scope from `const make = () => watch(…)`
 * beside it is only whose body the call sits in, which is the question `functionBodies` already
 * answers for the `once` region — so this is that answer handed out rather than a second rule that
 * would have to agree with it.
 *
 * Offsets are of the NAME, relative to `source`. A call in a type is not a call.
 */
export function statementCalls(source: string, names: ReadonlySet<string>): number[] {
    const cursor = tokenize(source, 0, source.length)
    const { tokens, nesting } = cursor
    const inType = typeRegions(tokens, nesting, false).marks
    const insideFunction = functionBodies(cursor, inType)
    const found: number[] = []
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (token.kind !== SyntaxKind.Identifier || !names.has(token.text)) continue
        if (insideFunction[i] === 1 || inType[i] === 1) continue
        // `x.watch(…)` is somebody's member, and `watch` alone is the name being read.
        if (tokens[i - 1]?.kind === SyntaxKind.DotToken) continue
        if (tokens[i + 1]?.kind !== SyntaxKind.OpenParenToken) continue
        found.push(token.start)
    }
    return found
}

export function desugar(
    source: string,
    from: number,
    to: number,
    reactive: ReadonlySet<string>,
    options: DesugarOptions,
): { text: string; reads: Read[] } {
    const expression = options.expression ?? true
    const keyedNames = options.keyed
    const hoisted = options.hoisted ?? NO_HOIST
    const reads: Read[] = []
    if (reactive.size === 0 && keyedNames.size === 0) {
        return { text: source.slice(from, to), reads }
    }

    const cursor = tokenize(source, from, to)
    const { tokens, nesting } = cursor
    // A type carries no expressions, so nothing in one is a read, a write, or a binding. Computed
    // ONCE for the region and consulted by both passes: pass one would otherwise collect the `n` in
    // `const a: typeof n = n` as a bound name and shadow the cell for the rest of the block, and
    // pass two would rewrite `type A = typeof n` into a call.
    const regions = typeRegions(tokens, nesting, expression)
    const inType = regions.marks
    const edits: Edit[] = []
    // Non-null only for a run-once region, so every other caller pays one null check for all of it.
    const insideFunction = options.once === true ? functionBodies(cursor, inType) : null

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
            // Back over a RETURN TYPE first. `(x: T): R => …` puts the annotation between the
            // parameters and the arrow, so the token before `=>` is the type's last one — read
            // directly it bound the TYPE's name and the parameters bound nothing, which left every
            // annotated arrow parameter shadowing an outer cell of that name.
            let at = i - 1
            while (
                at >= 0 &&
                (inType[at] === 1 || (tokens[at] as Token).kind === SyntaxKind.ColonToken)
            ) {
                at--
            }
            const previous = tokens[at]
            let indices: number[] = []
            if (previous?.kind === SyntaxKind.CloseParenToken) {
                const open = matchBackwards(cursor, at)
                if (open >= 0) indices = boundNames(cursor, open + 1, at, inType)
            } else if (previous?.kind === SyntaxKind.Identifier) {
                indices = [at]
            }
            const block = tokens[i + 1]?.kind === SyntaxKind.OpenBraceToken
            bind(indices, i, block ? level + 1 : level, !block)
            continue
        }

        // `catch (e)` binds its PARAMETER and nothing else. Read as a declarer it bound every
        // identifier in the block after it — a declarer's scan stops at the `=` that starts its
        // initialiser, and a catch has none, so the scan ran to the end of the block and every name
        // inside became a binding. A cell written in a `catch` was then left alone as though it had
        // been shadowed, which compiles to an assignment to a `const`.
        if (token.kind === SyntaxKind.CatchKeyword) {
            // A bare `catch { }` binds nothing, and so does anything that is not the shape below.
            if (tokens[i + 1]?.kind !== SyntaxKind.OpenParenToken) continue
            const close = matchForwards(cursor, i + 1)
            if (close <= 0) continue
            const brace = close + 1
            if (tokens[brace]?.kind !== SyntaxKind.OpenBraceToken) continue
            // Retired by INDEX rather than by depth, for the reason a `for` head is: the parameter is
            // inside the parens and the body is inside the braces, and nesting dips back out between
            // the two — so a depth rule kills the frame before the block that the parameter names.
            const end = matchForwards(cursor, brace)
            bind(boundNames(cursor, i + 2, close, inType), i, -1, false, end < 0 ? NO_END : end)
            continue
        }

        if (DECLARERS.has(token.kind)) {
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
            const names = boundNames(cursor, i + 1, end, inType)

            // `const count = state(0)` DECLARES the cell rather than hiding one, so it must not
            // shadow: treating it like any other binding makes the name reactive everywhere except
            // the body it was introduced in, which is every use of it. `state.shared(key, …)` is
            // the same declaration with an address in front of the value.
            //
            // The same question `emit.ts`'s `reactiveBindings` asks, over the shared
            // `REACTIVE_CONSTRUCTORS`, but forward from the declarer rather than back from the `(` —
            // that one is finding every declaration in a region, this one already has the binding and
            // is only deciding whether it declares or shadows.
            //
            // The type arguments are STEPPED OVER rather than required to be absent: `state<Kind>('a')`
            // is the same declaration as `state('a')`, and reading it as a binding made every use of
            // the name compile to the cell itself — so `kind !== 'all'` compared a function to a
            // string and was true forever, with nothing anywhere saying why.
            const maker = tokens[end + 1]?.text ?? ''
            // The same question over the text the EMIT writes rather than the text an author does.
            //
            // A `<script>` body does not reach this file as it was written: `bindProps` has already
            // spliced its own two lines into the front of it — `const { note: $note, pick } = args`,
            // and `const note = propCell($note)` under it. Both BIND names this file has been told
            // are reactive, so read as ordinary bindings they shadow the very props they create, for
            // the whole body. Every prop read in a setup was then left as the bare source:
            // `rows.length` was the arity of a function, `for (const r of rows)` iterated one, and a
            // keyed prop's `pick({ id })` handed back a handle nobody called.
            //
            // A TEMPLATE is its own region and neither line is in it, which is why props read
            // correctly there and this went unnoticed — the two halves of one file disagreed about
            // what a prop is.
            const declares =
                ((REACTIVE_CONSTRUCTORS.has(maker) || maker === 'propCell') &&
                    opensCall(cursor, end + 2)) ||
                (maker === 'state' &&
                    tokens[end + 2]?.kind === SyntaxKind.DotToken &&
                    tokens[end + 3]?.text === 'shared' &&
                    opensCall(cursor, end + 4)) ||
                // `const { … } = args` — the props destructure, whose right-hand side is the emitted
                // parameter and nothing else. The pattern is required as well as the name: `args.x` is
                // a read of one prop and binds whatever the author called it, which IS a shadow.
                (maker === 'args' &&
                    tokens[i + 1]?.kind === SyntaxKind.OpenBraceToken &&
                    tokens[end + 2]?.kind !== SyntaxKind.DotToken &&
                    tokens[end + 2]?.kind !== SyntaxKind.QuestionDotToken &&
                    tokens[end + 2]?.kind !== SyntaxKind.OpenBracketToken)
            if (declares) {
                for (const index of names) binding.add(index)
                continue
            }

            // `for (const x of …)` binds across the head AND the body; everything else is scoped by
            // the block it sits in, which the nesting rule already retires correctly. `for await` is
            // the same head — read as anything else, its name never shadowed the body it names.
            const head = forHeadAt(tokens, i - 1) !== null
            bind(names, i, head ? -1 : level, false, head ? forStatementEnd(cursor, i, level) : NO_END)
            continue
        }

        if (token.kind === SyntaxKind.FunctionKeyword) {
            let open = i + 1
            while (open < tokens.length && (tokens[open] as Token).kind !== SyntaxKind.OpenParenToken) open++
            const close = open < tokens.length ? matchForwards(cursor, open) : -1

            // TWO frames, because the name and the parameters have two different scopes and one
            // frame can only have the wider. The NAME belongs to the enclosing scope and outlives
            // the body; the PARAMETERS end with it.
            //
            // Collected separately for a second reason as well: `boundNames` reads DEPTH to tell a
            // type annotation from a destructuring key, and the parameters sit a level deeper than
            // the name. Spanning both, every ANNOTATED parameter read as a key and bound nothing —
            // `function f(count: number)` left `count` naming the outer cell and the body compiled
            // to `count()` over a plain number.
            bind(boundNames(cursor, i + 1, open, inType), i, level, false)
            if (close < 0) continue

            // Retired by INDEX, the way `catch` is and for the same reason: nesting dips back out
            // between the parens and the block, so a depth rule kills the frame before the body the
            // parameters name. Sharing the name's frame instead left every parameter shadowing for
            // the rest of the FILE — that frame opens at the enclosing level and so never retires —
            // and a cell read anywhere after the function came out as a bare identifier.
            let brace = close + 1
            // The first `{` that is not part of a RETURN TYPE: `function f(): { a: number } { … }`
            // has two, and the body is the second.
            while (
                brace < tokens.length &&
                ((tokens[brace] as Token).kind !== SyntaxKind.OpenBraceToken || inType[brace] === 1)
            ) {
                brace++
            }
            const end = brace < tokens.length ? matchForwards(cursor, brace) : -1
            bind(boundNames(cursor, open + 1, close, inType), close, -1, false, end < 0 ? NO_END : end)
        }
    }

    const closingColons = regions.ternary

    const frames: Frame[] = []
    // Token indices naming the TARGET of the write they sit inside, so their read peeks. Filled by
    // the write branch below, which the walk reaches before the right-hand-side tokens it marks.
    const selfReads = new Set<number>()
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

        if (token.kind !== SyntaxKind.Identifier || binding.has(i) || inType[i] === 1) continue
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
            if (!explicit && !verb && !awaited(previous) && !asyncIterated(tokens, i, close)) {
                const end = (tokens[close] as Token).end
                const key = source.slice(token.start, end).replace(/\s+/g, ' ')
                reads.push({ key, start: token.start, end, keyed: true })
                const local = hoisted.get(key)
                // Held alone as the whole region, the handle itself is what the caller wants — and in
                // a `cell` position that beats a hoisted local, which is a VALUE. See `hold`.
                const wholeRegion = token.start === (tokens[0] as Token).start && after === undefined
                const handedOver =
                    options.hold !== undefined && wholeRegion && (local === undefined || options.hold === 'cell')
                if (handedOver) {
                    // Nothing to write: the call already spells the handle.
                } else if (local !== undefined) {
                    // A hoisted read wins over reading again: the enclosing condition already
                    // subscribed to it, so a second read here would only subscribe twice for one
                    // change.
                    //
                    // The local holds the whole read, arguments included, so the walk skips the
                    // call's own tokens — rewriting inside a span that has been replaced produces
                    // overlapping edits, which is garbage rather than a wrong answer.
                    edits.push({ start: token.start, end, replacement: local })
                    i = close
                } else {
                    const peeks = insideFunction !== null && insideFunction[i] === 0
                    edits.push({ start: end, end, replacement: peeks ? '.peek()' : '()' })
                }
            }
            continue
        }

        if (!reactive.has(name) || shadowed(name)) continue

        // `.source` / `?.source` — a property, not this binding.
        if (previous?.kind === SyntaxKind.DotToken || previous?.kind === SyntaxKind.QuestionDotToken) continue
        // `await source` — the await IS the read. See `awaited`.
        if (awaited(previous)) continue
        // `{ source: … }` — an object literal key. NOT every `:`: a ternary's consequent is followed
        // by one too, and skipping `b` in `a ? b : c` left the cell unread — rendered as its own
        // function in a slot, and unconditionally truthy in a condition, so the true arm always won.
        if (next?.kind === SyntaxKind.ColonToken && !closingColons.has(i + 1)) continue
        // A non-null assertion is punctuation on the NAME, not part of the access after it, so step
        // over it before asking what that access is. Reading `tokens[i + 1]` alone, `source!()` and
        // `source!.set(v)` both fell through to the read branch and emitted `source()!()` and
        // `source()!.set(v)` — the CELL called, and then its VALUE called or written to.
        let accessAt = i + 1
        if (tokens[accessAt]?.kind === SyntaxKind.ExclamationToken) accessAt++
        const access = tokens[accessAt]

        // `source()` and `source?.()` — the author wrote the read. WITH ARGUMENTS it is not one: a
        // cell read takes none, so the arguments belong to whatever the cell HOLDS, and the read has
        // to be emitted for them to reach it. That is what carries a CALLBACK prop through a lane
        // where no type said it was a callback — `onpick(row.id)` becomes `onpick()(row.id)`.
        // Keyed names never reach here: `m(args)` selects a slot and is answered above.
        const opensAt =
            access?.kind === SyntaxKind.OpenParenToken
                ? accessAt
                : access?.kind === SyntaxKind.QuestionDotToken &&
                    tokens[accessAt + 1]?.kind === SyntaxKind.OpenParenToken
                  ? accessAt + 1
                  : -1
        if (opensAt >= 0 && tokens[opensAt + 1]?.kind === SyntaxKind.CloseParenToken) continue
        // `source.set(…)` and the rest of the reserved surface. Matched on TEXT, not kind: `set` and
        // `get` scan as contextual keywords rather than identifiers.
        const member = tokens[accessAt + 1]
        if (
            (access?.kind === SyntaxKind.DotToken || access?.kind === SyntaxKind.QuestionDotToken) &&
            member !== undefined &&
            SOURCE_SURFACE.has(member.text)
        ) {
            continue
        }

        // `source++` / `source--`, and the prefix forms — each guarded by the rule that says which
        // statement the operator belongs to, because in a file written without semicolons a `++` has a
        // neighbour on both sides and only one of them is its operand.
        //
        // POSTFIX is a restricted production: `a [no LineTerminator here] ++`. So a `++` that starts a
        // line is the next statement's prefix, and `count` / newline / `++other` is two statements.
        //
        // PREFIX is not restricted, so the test on that side is whether the operator is already SPOKEN
        // FOR: it is somebody else's postfix only if the token before it ends an expression AND no line
        // break separates the two. `n++` on the line above ends its own statement, and reading its `++`
        // as a prefix on this name emitted `nc.set(c.peek() + 1) = 2` — a module that does not parse,
        // out of a file that type-checks. Both halves of that test are load-bearing: without the first,
        // `++count` at the top of a block is not an increment; without the second, `n = 1` / newline /
        // `++count` reads the operator as the literal's postfix and emits `++count()`.
        const postfix =
            (next?.kind === SyntaxKind.PlusPlusToken || next?.kind === SyntaxKind.MinusMinusToken) &&
            !next.startsLine
        const operand = tokens[i - 2]
        const spokenFor =
            previous !== undefined &&
            !previous.startsLine &&
            operand !== undefined &&
            ENDS_EXPRESSION.has(operand.kind)
        const prefix =
            (previous?.kind === SyntaxKind.PlusPlusToken ||
                previous?.kind === SyntaxKind.MinusMinusToken) &&
            !spokenFor
        const update = postfix ? next : prefix ? previous : undefined
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
            // The TARGET named on its own right-hand side is the same claim the opener above makes by
            // peeking, and plain `=` was the one spelling of the three that missed it: `count = count
            // + 1` inside a `watch` subscribed the effect to the cell it writes, so every OTHER
            // writer's write woke it — the same value, one extra run, and nothing about the output
            // moves. `++` and `+=` were right because their read is synthesised rather than walked.
            //
            // Only the target's own name: `total = total + rate` still subscribes to `rate`, which is
            // a dependency the author does mean. And `count = count() + 1` still subscribes to
            // `count`, because a call the author wrote is left alone — the sugar is over the explicit
            // spelling, so the subscribing read stays reachable.
            for (let j = i + 2; j < rhs.endIndex; j++) {
                const at = tokens[j] as Token
                if (at.kind === SyntaxKind.Identifier && at.text === name) selfReads.add(j)
            }
            // The opener swallows the gap after `=` too, so the emitted call has no stray space.
            edits.push({ start: token.start, end: rhs.start, replacement: opener })
            edits.push({ start: rhs.end, end: rhs.end, replacement: logical !== undefined ? '))' : ')' })
            continue
        }

        // `{ source }` — object shorthand, which has to grow its key to stay an object.
        const shorthand =
            (previous?.kind === SyntaxKind.OpenBraceToken || previous?.kind === SyntaxKind.CommaToken) &&
            (next?.kind === SyntaxKind.CommaToken || next?.kind === SyntaxKind.CloseBraceToken) &&
            inObjectLiteral(cursor.tokens, cursor.nesting, i, expression)
        reads.push({ key: name, start: token.start, end: token.end, keyed: false })
        const local = hoisted.get(name)
        // Held alone as the whole region, the cell itself is what the caller wants — `bind:`, `&ref`
        // and a component prop need the cell and not its value, which is why a `cell` position holds
        // even over a hoisted local. A `slot` takes the local: the enclosing condition already
        // subscribed to it and `unwrap` reads a slot's cell one step further either way.
        //
        // This is what `hold` says it does, and the keyed branch has asked it since it was written.
        // The plain branch never did: `code`'s `IDENTIFIER.test` fast path in `emit.ts` was standing
        // in, and that tests the raw SOURCE, so a region that is one identifier plus ANYTHING —
        // a comment, a paren, a `!` — fell through to a read. `<Child value={count /* note */}/>`
        // handed the child a number, `cellProps` made a fresh `state()` out of it, and no write on
        // either side ever reached the other. Correct on the first paint, dead after it.
        if (
            options.hold !== undefined &&
            (local === undefined || options.hold === 'cell') &&
            namesWholeRegion(tokens, i, inType)
        ) {
            continue
        }
        // The same hold the keyed branch takes, for the same reason: a cell is an async iterable and
        // `for await` wants the cell.
        if (asyncIterated(tokens, i, i)) continue
        const peeking = selfReads.has(i) || (insideFunction !== null && insideFunction[i] === 0)
        const read = local ?? (peeking ? `${name}.peek()` : `${name}()`)
        edits.push({
            start: token.start,
            end: token.end,
            replacement: shorthand ? `${name}: ${read}` : read,
        })
    }

    return { text: apply(source, from, to, edits), reads }
}

/**
 * Whether a call opens at `at`, stepping over a type-argument list if one is written first.
 *
 * `closeAngle` rather than a second run-counter over `<` and `>`: two walkers that could disagree
 * about where a type stops would put the rewrite one token off at exactly the place they disagreed,
 * and `types.ts` is where that rule lives. It counts a run of `>` by TEXT, so `Memo<Array<string>>`
 * closing with one `>>` token needs no enumeration of the shifted forms here.
 */
function opensCall(cursor: Cursor, at: number): boolean {
    const tokens = cursor.tokens
    const first = tokens[at]
    if (first === undefined) return false
    if (first.kind === SyntaxKind.OpenParenToken) return true
    if (first.kind !== SyntaxKind.LessThanToken) return false

    // Nothing closed it, so this `<` is the comparison it also spells — `a < (b)` must not be read
    // as a call with type arguments.
    const past = closeAngle(tokens, at)
    if (past <= at + 1) return false
    return tokens[past]?.kind === SyntaxKind.OpenParenToken
}

/**
 * Is the name at `at` the whole VALUE of this region — the question `hold` actually asks?
 *
 * Not "the only token": a wrapper that cannot change WHICH cell this is has to come off first.
 * Balanced parens around it, a trailing `!`, and an `as T` / `satisfies T` tail are all punctuation
 * on the name, and each of them used to turn a hand-over into a read. `{count!}` is the one that
 * bites — someone silences a strict-null complaint on a prop and the binding dies, because
 * `count()!` type-checks, paints correctly once, and never updates again.
 *
 * Comments and whitespace need no arm here: the scanner emits no token for either, which is why
 * `{count /* n *\/}` already held.
 */
function namesWholeRegion(tokens: Token[], at: number, inType: Uint8Array): boolean {
    let opens = 0
    for (let i = 0; i < at; i++) {
        if ((tokens[i] as Token).kind !== SyntaxKind.OpenParenToken) return false
        opens++
    }
    let closes = 0
    for (let i = at + 1; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (inType[i] === 1 || TYPE_CAST_KEYWORDS.has(token.text)) continue
        if (token.kind === SyntaxKind.ExclamationToken) continue
        if (token.kind === SyntaxKind.CloseParenToken) {
            closes++
            continue
        }
        return false
    }
    // Unbalanced means the parens are somebody else's — `f(count)` opens one this name does not own.
    return opens === closes
}

/**
 * Which tokens sit inside a FUNCTION BODY — the re-runnable part of a region that otherwise runs once.
 *
 * A body is a `{…}` after `=>`, a `{…}` whose head is a parameter list — `function f(a) {`,
 * `function (a) {`, `m(a) {`, `get x() {` — or the expression an arrow returns without braces. The
 * parameter-list test is what makes the control forms fall out for free rather than being listed:
 * `if`, `for`, `while`, `switch` and `catch` all scan as their own keyword kinds, so the `(` in front
 * of their block is never preceded by an identifier or by `function`.
 *
 * Anything already inside a body is skipped rather than re-marked, which is what keeps this linear
 * over nesting instead of quadratic.
 */
function functionBodies(cursor: Cursor, inType: Uint8Array): Uint8Array {
    const { tokens, nesting } = cursor
    const inside = new Uint8Array(tokens.length)
    const mark = (from: number, to: number): void => {
        for (let j = Math.max(from, 0); j < to && j < tokens.length; j++) inside[j] = 1
    }
    for (let i = 0; i < tokens.length; i++) {
        if (inside[i] === 1 || inType[i] === 1) continue
        const token = tokens[i] as Token
        if (token.kind === SyntaxKind.EqualsGreaterThanToken) {
            const level = nesting[i] as number
            if (tokens[i + 1]?.kind === SyntaxKind.OpenBraceToken) {
                const close = matchForwards(cursor, i + 1)
                mark(i + 1, close < 0 ? tokens.length : close)
            } else {
                mark(i + 1, expressionEnd(cursor, i + 1, level))
            }
            continue
        }
        if (token.kind !== SyntaxKind.OpenBraceToken) continue
        // Back over a RETURN TYPE, which sits between the parameter list and the body:
        // `async function run(): Promise<void> {` has a `>` in front of its brace, not a `)`.
        // The `:` itself is outside the marked region — the mark starts at the type — so it is named
        // here rather than assumed.
        let head = i - 1
        while (head >= 0 && (inType[head] === 1 || (tokens[head] as Token).kind === SyntaxKind.ColonToken)) {
            head--
        }
        if (tokens[head]?.kind !== SyntaxKind.CloseParenToken) continue
        const open = matchBackwards(cursor, head)
        const before = open <= 0 ? undefined : tokens[open - 1]
        if (before?.kind !== SyntaxKind.Identifier && before?.kind !== SyntaxKind.FunctionKeyword) continue
        const close = matchForwards(cursor, i)
        mark(i, close < 0 ? tokens.length : close)
    }
    return inside
}

function matchForwards(cursor: Cursor, openIndex: number): number {
    const target = cursor.nesting[openIndex] as number
    for (let i = openIndex + 1; i < cursor.tokens.length; i++) {
        if ((cursor.nesting[i] as number) === target - 1) return i
    }
    return -1
}

/**
 * A token that can CONTINUE the expression in front of it across a line break.
 *
 * The other half of ASI. `a\n+ b` is one expression and `a\nb()` is two statements, and the
 * difference is entirely this list: an operator, a member access, or the opener of a call, an index
 * or a tagged template keeps the line before it going.
 */
const CONTINUES_EXPRESSION = new Set<SyntaxKind>([
    SyntaxKind.DotToken,
    SyntaxKind.QuestionDotToken,
    SyntaxKind.OpenParenToken,
    SyntaxKind.OpenBracketToken,
    SyntaxKind.TemplateHead,
    SyntaxKind.NoSubstitutionTemplateLiteral,
    SyntaxKind.CommaToken,
    SyntaxKind.QuestionToken,
    SyntaxKind.ColonToken,
    SyntaxKind.EqualsGreaterThanToken,
    SyntaxKind.PlusToken,
    SyntaxKind.MinusToken,
    SyntaxKind.AsteriskToken,
    SyntaxKind.AsteriskAsteriskToken,
    SyntaxKind.SlashToken,
    SyntaxKind.PercentToken,
    SyntaxKind.LessThanToken,
    SyntaxKind.LessThanEqualsToken,
    SyntaxKind.GreaterThanToken,
    SyntaxKind.GreaterThanEqualsToken,
    SyntaxKind.EqualsEqualsToken,
    SyntaxKind.EqualsEqualsEqualsToken,
    SyntaxKind.ExclamationEqualsToken,
    SyntaxKind.ExclamationEqualsEqualsToken,
    SyntaxKind.AmpersandToken,
    SyntaxKind.AmpersandAmpersandToken,
    SyntaxKind.BarToken,
    SyntaxKind.BarBarToken,
    SyntaxKind.CaretToken,
    SyntaxKind.QuestionQuestionToken,
    SyntaxKind.LessThanLessThanToken,
    SyntaxKind.GreaterThanGreaterThanToken,
    SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
    SyntaxKind.InKeyword,
    SyntaxKind.InstanceOfKeyword,
    SyntaxKind.AsKeyword,
    SyntaxKind.SatisfiesKeyword,
])

/**
 * Where the right-hand side of an assignment ends: the first `,` `;` or closer at or below the
 * assignment's own level — or the LINE BREAK that ended the statement.
 *
 * The line break is not a nicety. This project is written without semicolons, so `count = n` followed
 * by the next statement has nothing between them but a newline: stopping only at `;` swallowed
 * whatever came next into the call, and `count = n` then `await run()` compiled to
 * `count.set(n await run())`. Which is a syntax error, so it was loud — but the same shape with a
 * `console.log` on the next line is valid code that writes the wrong thing.
 *
 * Approximated the way ASI itself is: a break ends the statement when the token before it could have
 * ended an expression and the token after it could not continue one.
 */
function assignmentEnd(
    cursor: Cursor,
    from: number,
    level: number,
    limit: number,
): { start: number; end: number; endIndex: number } {
    const first = cursor.tokens[from]
    if (first === undefined) {
        throw new SyntaxError_('abide: assignment with nothing on the right', limit)
    }
    // The token index as well as the offsets: the caller walks the right-hand side's TOKENS to find
    // the target read on itself, and a second `expressionEnd` to recover it could disagree with this.
    const endIndex = expressionEnd(cursor, from, level)
    const last = cursor.tokens[endIndex - 1] as Token
    return { start: first.start, end: last.end, endIndex }
}

/** The same rule as an index, which is what an expression-bodied arrow's extent is measured in. */
function expressionEnd(cursor: Cursor, from: number, level: number): number {
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
        // Never on the first token: `x =` and its right-hand side on the next line is one statement,
        // whatever that token is.
        if (
            i > from &&
            token.startsLine &&
            !CONTINUES_EXPRESSION.has(token.kind) &&
            ENDS_EXPRESSION.has((cursor.tokens[i - 1] as Token).kind)
        ) {
            break
        }
        i++
    }
    return i
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
