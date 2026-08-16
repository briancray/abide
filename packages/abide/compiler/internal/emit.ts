// The node tree becomes the file a careful author would have written by hand.
//
// Not a pre-scanned `TemplateResult`: an `html` tagged template, the shape `packages/dogfood/counter.ts`
// already is. `planOf` and `prepare` are keyed on the `strings` identity a tagged template gives
// for free, so the scan and the parse happen once per call site whatever the compiler does — and
// what pre-scanning would buy is one scan per call site per process, against a stack trace that no
// longer points at anything a person wrote.
//
// The one invariant every emit rule serves: an expression that could READ something reactive gets its
// own thunk, and evaluating an `html` tag does not call the thunks inside it. So the thunk around a
// `{#if}` subscribes to the condition and nothing else, and a `{count}` deep inside the branch still
// wakes alone. Wrapping a whole branch body in one thunk would produce identical output at a much
// coarser wake.
//
// The exceptions are named by `unthunked` rather than left implicit, because a thunk is not free on
// the client: it is a closure per instance AND an effect node with an observer set per slot. A fresh
// closure per row also defeats `Instance.update`'s identity cutoff, so an unchanged row of a
// thousand-row list can never be skipped — which made a one-row edit cost the whole list.

import { SyntaxKind } from 'typescript/unstable/ast'
import { scopeCss, scopeName } from './css.ts'
import {
    CLOSERS,
    desugar,
    NO_HOIST,
    OPENERS,
    parameterNames,
    REACTIVE_CONSTRUCTORS,
    REACTIVE_TYPES,
} from './desugar.ts'
import { kindOf } from './elide.ts'
import { type Token, tokensOf } from './lex.ts'
import { extract, mark, type Segment } from './map.ts'
import type { Attribute, Blocks, Branch, Expr, Node } from './parse.ts'
import { HTML_COMMENT, IDENTIFIER, ParseError } from './parse.ts'
import { type TypeSource, TypeReader } from './shape.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

export interface EmitOptions {
    /** Used for the default export's name and for error messages. */
    filename: string
    /**
     * The text of a module this one imports its PROPS TYPE from, so the members can be classified.
     *
     * Injected rather than reached for, exactly as `ElideOptions.resolve` is and for the same two
     * reasons: this pass does no I/O, and a demo hands over a map in memory so a case still runs in
     * a browser. It reads TEXT and runs the same member regex over it — no checker enters the emit
     * path, and what a cell is stays a syntactic question.
     *
     * `| undefined` explicitly, because `exactOptionalPropertyTypes` otherwise refuses `compile`'s
     * own optional straight through.
     */
    resolve?: TypeSource | undefined
}

interface Context {
    source: string
    /** What a scope name is hashed against, so two files with the same rules keep their own. */
    filename: string
    /**
     * Every scope in force here, as the attribute text an element carries — `data-a<hash>` for the
     * component's own `<style>`, plus one more for each nested block enclosing this position. Already
     * joined, because the walk reads it far more often than it extends it.
     */
    scope: string | null
    /**
     * Every block registered so far, scope name → its `adopt(…)` statement, in registration order.
     * Shared by reference across every derived context, so a nested block found deep in the walk
     * still lands at module scope — and so the cascade order is the order they were WRITTEN.
     */
    sheets: Map<string, string>
    /**
     * Static arrays lifted to module scope, array literal → the name it was bound to.
     *
     * Only `class:`/`style:` toggle NAMES so far, and content-addressed for the reason `sheets` is:
     * two elements toggling the same names share one array. Shared by reference across every derived
     * context, so a toggle found inside a `{#for}` body still lands at module scope — which is the
     * whole point, since the alternative is rebuilding it on every wake of that row's binding.
     */
    lifted: Map<string, string>
    reactive: Reactive
    /** Names bound by a `{#for}` or a branch, which shadow a reactive name of the same spelling. */
    shadow: Set<string>
    /** Reads a `{#if}` or `{#switch}` already took into a local, so the body narrows off it. */
    hoisted: Map<string, string>
    /**
     * What `<slot/>` renders, as the emitted file spells it here.
     *
     * `args.children` in a component's own body, but an INLINE `{#component X(props)}` names its
     * parameter itself — and emitting `args.children` inside one reached past it to the enclosing
     * component, dropping the children the caller passed and rendering the parent's instead. Silent:
     * the declared prop type carries `children`, so it type-checks. `null` where the parameter is a
     * destructuring pattern that did not bind them, which is a `<slot/>` with nothing to name.
     */
    children: string | null
    /**
     * Names an inline `{#component X(…)}` in this file bound, which `<X/>` calls DIRECTLY.
     *
     * An inline component is a body with a parameter list and no `<script>`, so it has no setup to
     * run once and nothing to keep between passes — the whole reason a tag is carried rather than
     * called. Carrying one would also cell its props, and its parameter type is written by hand:
     * `{#component Row({ n }: { n: number })}` says `n` is a number, and it is.
     */
    inline: Set<string>
    /**
     * Inside a `{#try}`: expressions are emitted UNTHUNKED so the boundary is one unit. An
     * expression that produced its value in a nested effect would throw into that effect's own
     * isolation, past the boundary's try/catch, and the boundary would catch nothing.
     */
    eager: boolean
    /** Runtime names the emitted file turned out to need. */
    used: Set<string>
    counter: { n: number }
}

// Every name here must be an export of `abide`, because that is the import the header writes.
// `component` and `propCell` are the two halves of one rule: `<Thing/>` CARRIES the call rather than
// making it, so the position that shows it can hold the instance across a re-render, and the props
// arrive as cells the child binds through `propCell`. See docs/COMPONENTS.md.
type Runtime =
    | 'html'
    | 'raw'
    | 'keyed'
    | 'classes'
    | 'styles'
    | 'awaited'
    | 'boundary'
    | 'component'
    | 'propCell'
    | 'streamed'
    | 'adopt'
    | 'start'

/**
 * The two an author also types, so the header keeps them on `abide`.
 *
 * `keyed` is NOT authored, despite reading like it: a key is spelled `by` on a `{#for}`, which is
 * what this emitter writes `keyed` for and never what a source file says.
 *
 * `raw` used to be on that side, reached by spelling it `{html(...)}` — and that made `html` mean
 * ESCAPE as a tag and INSERT-RAW as a call, one public name with two opposite answers about trust,
 * told apart only by a backtick. The hatch is now spelled with its own name.
 */
const AUTHORED_RUNTIME: ReadonlySet<string> = new Set<Runtime>(['html', 'raw'])

/** The absent region — a file with no `<script module>`, or no `<script>`. Shared, never written. */
const NO_TOKENS: Token[] = []

/** A file with no `props()` at all, which is most of them. Shared, never written. */
const NO_KINDS: Map<string, PropKind> = new Map()

/** A keyword that is a deliberate error in a region, reported at the token that spelled it. */
function forbidKeyword(tokens: Token[], kind: SyntaxKind, message: string): void {
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (token.kind === kind) throw new ParseError(message, token.start)
    }
}

/** Statement-position `export` inside a `<script>`, which SPEC makes a deliberate error. */
function checkNoExport(tokens: Token[], filename: string): void {
    forbidKeyword(
        tokens,
        SyntaxKind.ExportKeyword,
        `abide: \`export\` in a <script> is not allowed (${filename}) — a <script> body is inlined ` +
            `into the component setup, so the export has nowhere to go. Move it to <script module>.`,
    )
}

/**
 * What a `<script>` makes reactive, split by WHICH THING is the cell.
 *
 * `memo` is one name with two forms, and the difference decides how the binding is read:
 *
 *   const doubled = memo(() => …)          argless -> the NAME is the cell:  doubled + 1
 *   const details = memo(({ id }) => …)    keyed   -> the CALL is the cell:  details({ id }) + 1
 *
 * Which one it is comes from whether the body declares a parameter — abide's own rule, and visible
 * right there at the declaration, so no checker is needed to see it. Getting this wrong is not a
 * missing convenience: `details({ id }).pages` on a keyed memo is valid JavaScript that quietly
 * evaluates to `undefined`, because the handle has no `pages`.
 */
interface Reactive {
    /** Read by name. */
    cells: Set<string>
    /** Read by call — `m(args)` selects the slot and hands back its cell. */
    keyed: Set<string>
}

/**
 * The same grammar `desugar`'s binding walk reads, from the other end.
 *
 * Both ask "is the initializer at this `=` a source constructor", and the VOCABULARY is shared —
 * `REACTIVE_CONSTRUCTORS` is declared once, in `desugar.ts`, so neither can drift about what
 * constructs a source. What is not shared is the walk, because the two anchor differently: this one
 * starts at a `(` and steps BACK to find the callee and the name, since it is looking for every
 * declaration in a region; `desugar`'s starts at the declarer keyword and steps FORWARD, since it
 * already has a binding in hand and is only asking whether it declares rather than shadows. Merging
 * them would mean one walk that does both, which is more machinery than the predicate they share.
 */
function reactiveBindings(tokens: Token[], into: Reactive, memos?: Map<string, readonly string[]>): void {
    for (let i = 1; i < tokens.length; i++) {
        // `NAME = state(` — or `NAME = state<T>(`, whose type argument list sits between the two.
        if ((tokens[i] as Token).kind !== SyntaxKind.OpenParenToken) continue
        const callee = calleeBefore(tokens, i)
        if (callee < 1) continue
        let at = callee
        let maker = (tokens[callee] as Token).text
        // `state.shared(key, …)` is `state` with an address in front of the value, so the binding is
        // a cell exactly as `state(…)` is. Stepping back over the member access is what lets the one
        // rule below see it — without this the callee reads as `shared`, which constructs nothing.
        if (
            maker === 'shared' &&
            tokens[at - 1]?.kind === SyntaxKind.DotToken &&
            tokens[at - 2]?.text === 'state'
        ) {
            at -= 2
            maker = 'state'
        }
        if (!REACTIVE_CONSTRUCTORS.has(maker)) continue
        if (tokens[at - 1]?.kind !== SyntaxKind.EqualsToken) continue
        const name = tokens[at - 2]
        if (name === undefined || name.kind !== SyntaxKind.Identifier) continue

        if (maker === 'channel') {
            // `channel<T, Args>()` is the ROOM form, and the second type argument is the only place
            // that is visible: there is no body to read a parameter off, so the declaration says it
            // in the one way a syntactic rule can see. The call selects a room, so it is read by
            // CALL — the same split `memo` has between its two forms.
            if (multipleTypeArguments(tokens, at + 1, i)) into.keyed.add(name.text)
            else into.cells.add(name.text)
            continue
        }
        if (maker !== 'memo') {
            into.cells.add(name.text)
            continue
        }
        // Past an `async`, the body's own parameter list decides the form.
        let body = i + 1
        if (tokens[body]?.kind === SyntaxKind.AsyncKeyword) body++
        if (tokens[body]?.kind !== SyntaxKind.OpenParenToken) {
            // `memo(fn)` — a reference, whose shape is not visible here. Read by name, as before.
            into.cells.add(name.text)
            // Which memos this one reads, so a template naming only a DERIVATION can still be
            // resolved back to the loads under it — see `rootsOf`.
            memos?.set(name.text, memosReferenced(tokens, i, memos))
            continue
        }
        if (tokens[body + 1]?.kind === SyntaxKind.CloseParenToken) {
            into.cells.add(name.text)
            memos?.set(name.text, memosReferenced(tokens, i, memos))
        }
        else into.keyed.add(name.text)
    }
}

/**
 * Does the type argument list between `from` and `to` declare more than one type?
 *
 * Counted rather than parsed: a comma at the list's own depth separates two type arguments, and one
 * nested inside a `{ … }`, a tuple or another list does not. `=>` is skipped by kind, because the
 * character walk that closes `<…>` would otherwise read a function type's arrow as a close.
 */
function multipleTypeArguments(tokens: Token[], from: number, to: number): boolean {
    let depth = 0
    for (let at = from; at < to; at++) {
        const token = tokens[at] as Token
        if (token.kind === SyntaxKind.EqualsGreaterThanToken) continue
        if (token.kind === SyntaxKind.CommaToken) {
            if (depth === 1) return true
            continue
        }
        if (OPENERS.has(token.kind)) {
            depth++
            continue
        }
        if (CLOSERS.has(token.kind)) {
            depth--
            continue
        }
        for (const character of token.text) {
            if (character === '<') depth++
            else if (character === '>') depth--
        }
    }
    return false
}

/**
 * The index of the identifier being CALLED at `open`, stepping back over a type argument list.
 *
 * `state<Received<T>>(…)` is an ordinary declaration and has to be recognised as one; without this
 * the token before `(` is `>`, the match fails, and the binding is silently not reactive — which
 * shows up much later as `.trim()` on a `State<string>` rather than on the string.
 */
function calleeBefore(tokens: Token[], open: number): number {
    let at = open - 1
    const previous = tokens[at]
    if (previous === undefined) return -1
    if (!previous.text.endsWith('>')) return at
    // `>>` closing two nested lists scans as ONE token, so depth is counted in characters.
    let depth = 0
    while (at >= 0) {
        for (const character of (tokens[at] as Token).text) {
            if (character === '>') depth++
            else if (character === '<') depth--
        }
        if (depth <= 0) break
        at--
    }
    return at - 1
}

/**
 * What `const { … } = props<T>()` declared.
 *
 * The whole props surface is this one call: the type argument BECOMES the emitted function's
 * parameter type, and the destructuring pattern beside it is what brings each prop into scope. There
 * is no `args` object an author can name, which is the point — every identifier a `<script>` uses was
 * imported or bound by the person who wrote it.
 */
interface Props {
    /** The type argument's text, or `null` for a bare `props()`. */
    type: string | null
    /** Every identifier the pattern bound, in source order. */
    bound: Binding[]
    /** The call's extent in the body it was found in, so the emit can splice the parameter in. */
    start: number
    end: number
}

/**
 * One entry of that pattern: what the prop is called, what this file calls it, and where both sit.
 *
 * The positions are what lets the emit REWRITE the pattern rather than read it. A prop arrives as a
 * cell, and a destructure default cannot survive that — `class: className = ''` leaves the local
 * `'' | Cell<string>` when the caller omits it, and only one of those is callable. So the local moves
 * out of the pattern and the default moves into `propCell` beside it.
 */
interface Binding {
    /** The prop's name on the props object — `class` in `{ class: className }`. */
    name: string
    /** The identifier this file bound it to. */
    local: string
    /** Whether the pattern SPELLS the rename, so re-emitting it does not double the `name:`. */
    renamed: boolean
    /** Where `local` sits in the setup body. */
    start: number
    end: number
    /** The `= …` default's text and extent, or `null` and zeroes. */
    fallback: string | null
    fallbackStart: number
    fallbackEnd: number
}

/**
 * The `props<T>()` call in a setup body, or `null`.
 *
 * Recognised by TOKENS rather than by a regex because the type argument is a type: `props<Row<Book>>()`
 * closes two lists in one `>>` token, and the extent of a type is a question this file already has one
 * answer to.
 */
function propsCall(body: string, tokens: Token[], types: TypeReader): Props | null {
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (token.kind !== SyntaxKind.Identifier || token.text !== 'props') continue
        // `state.props` is somebody's property, not this call.
        if (tokens[i - 1]?.kind === SyntaxKind.DotToken) continue

        let open = i + 1
        let type: string | null = null
        const after = types.tryTypeArguments(i + 1)
        if (after > 0) {
            // The list's own `<` is one character; its close is the last character of the last token,
            // which may be the `>>` that also closes a nested list.
            const last = tokens[after - 1] as Token
            type = body.slice((tokens[i + 1] as Token).end, last.end - 1).trim()
            open = after
        }
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        if (tokens[open + 1]?.kind !== SyntaxKind.CloseParenToken) continue
        return {
            type: type === '' ? null : type,
            bound: destructured(body, tokens, i),
            start: token.start,
            end: (tokens[open + 1] as Token).end,
        }
    }
    return null
}

/**
 * The pattern to the LEFT of the call, one `Binding` per identifier entry.
 *
 * Only identifier-to-identifier entries are collected, because this decides which locals are cells and
 * a prop destructured any FURTHER is not one. A rest element and a nested pattern are left to the
 * emitted TypeScript, which handles them the way it handles any other destructure — and neither
 * becomes a cell, so both keep whatever the caller passed.
 */
function destructured(body: string, tokens: Token[], call: number): Binding[] {
    const bound: Binding[] = []
    if (tokens[call - 1]?.kind !== SyntaxKind.EqualsToken) return bound
    const close = call - 2
    if (tokens[close]?.kind !== SyntaxKind.CloseBraceToken) return bound

    let open = close
    let depth = 0
    for (; open >= 0; open--) {
        const kind = (tokens[open] as Token).kind
        if (CLOSERS.has(kind)) depth++
        else if (OPENERS.has(kind) && --depth === 0) break
    }
    if (open < 0) return bound

    // Where each entry starts AND ends: the token after the brace, and the token on either side of
    // every comma at the pattern's own depth. The END is what a default runs to.
    const starts = [open + 1]
    const ends: number[] = []
    depth = 0
    for (let i = open + 1; i < close; i++) {
        const token = tokens[i] as Token
        if (OPENERS.has(token.kind)) depth++
        else if (CLOSERS.has(token.kind)) depth--
        else if (token.kind === SyntaxKind.CommaToken && depth === 0) {
            ends.push(i)
            starts.push(i + 1)
        }
    }
    ends.push(close)

    for (let entry = 0; entry < starts.length; entry++) {
        const at = starts[entry] as number
        const to = ends[entry] as number
        const name = tokens[at]
        if (name === undefined || at >= to || !IDENTIFIER.test(name.text)) continue

        let local = name
        let renamed = false
        let after = at + 1
        if (tokens[at + 1]?.kind === SyntaxKind.ColonToken) {
            // `class: className` — a rename, and the only spelling a reserved word has.
            const target = tokens[at + 2]
            if (target === undefined || !IDENTIFIER.test(target.text)) continue
            local = target
            renamed = true
            after = at + 3
        }
        const equals = tokens[after]
        const defaulted = after < to && equals !== undefined && equals.kind === SyntaxKind.EqualsToken
        const last = tokens[to - 1] as Token
        bound.push({
            name: name.text,
            local: local.text,
            renamed,
            start: local.start,
            end: local.end,
            fallback: defaulted ? body.slice((tokens[after + 1] as Token).start, last.end) : null,
            fallbackStart: defaulted ? (equals as Token).start : 0,
            fallbackEnd: defaulted ? last.end : 0,
        })
    }
    return bound
}

/** A body the lexer cannot read is one the desugar is about to fail on with a position of its own. */
function tokensOfBody(rest: string): Token[] {
    try {
        return tokensOf(rest)
    } catch {
        return []
    }
}

/**
 * The MEMBERS of the declared props type, as text.
 *
 * An inline `props<{ id: string }>()` is already the members. A name is resolved against the setup
 * body's own declarations and no further: a type imported from another file cannot be read from here,
 * and the consequence is only that its cell props stay plain values — the same degradation an imported
 * type has always had, and the reason the explicit `x()` spelling never stops compiling.
 */
function membersOf(type: string, rest: string, tokens: Token[], types: TypeReader): string {
    if (type.startsWith('{')) return type
    if (!IDENTIFIER.test(type)) return ''
    for (const found of declaredTypes(tokens, types)) {
        if (found.name === type) return rest.slice(found.start, found.end)
    }
    return ''
}

/**
 * Which module a `<script>` imported a name from, and what it is called there.
 *
 * Read off the LIFTED import statements, since `splitImports` has already taken them out of the body
 * the props call is read from. Only a braced binding counts: a default import binds a value, and a
 * namespace reaches a type only through a qualified name that nothing here resolves.
 */
function importBinding(imports: readonly string[], local: string): { specifier: string; exported: string } | null {
    for (const statement of imports) {
        let tokens: Token[]
        try {
            tokens = tokensOf(statement)
        } catch {
            continue
        }
        let specifier = ''
        for (let i = tokens.length - 1; i >= 0; i--) {
            const token = tokens[i] as Token
            if (token.kind === SyntaxKind.StringLiteral) {
                specifier = token.text.slice(1, -1)
                break
            }
        }
        if (specifier === '') continue
        let braced = false
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i] as Token
            if (token.kind === SyntaxKind.OpenBraceToken) braced = true
            else if (token.kind === SyntaxKind.CloseBraceToken) braced = false
            if (!braced || token.kind !== SyntaxKind.Identifier || token.text !== local) continue
            // `Exported as local` — the name over there is two tokens back. The LEFT side of a rename
            // is the exported name and not this local, so a match there is not this binding.
            if (tokens[i - 1]?.text === 'as' && tokens[i - 2]?.kind === SyntaxKind.Identifier) {
                return { specifier, exported: (tokens[i - 2] as Token).text }
            }
            if (tokens[i + 1]?.text === 'as') continue
            return { specifier, exported: local }
        }
    }
    return null
}

/**
 * The members of a props type declared in ANOTHER module, as text.
 *
 * The gap this closes was not a missing type-checker — `classifyMember` is a regex over the member's
 * declaration text — it was the other file's bytes. So the same `declaredTypes` walk runs over the
 * resolved module and the same slice comes back, and an imported `RowProps` classifies exactly as
 * the inline spelling does. Without it the two disagreed: a FUNCTION member fell to the `cell`
 * fallback, `propCell` wrapped the handler, and `onpick(row.id)` called the CELL and threw the
 * handler away — a dead click in a file where nothing near the call mentions a cell.
 *
 * Answers `''` for anything it cannot follow — no resolver, an unreadable module, a name declared
 * somewhere the walk does not reach — which is the fallback the caller already had.
 */
function importedMembers(
    type: string,
    imports: readonly string[],
    importer: string,
    resolve: TypeSource | undefined,
): string {
    if (resolve === undefined || !IDENTIFIER.test(type)) return ''
    const binding = importBinding(imports, type)
    if (binding === null) return ''
    const found = resolve(binding.specifier, importer)
    if (found === null) return ''
    let tokens: Token[]
    try {
        tokens = tokensOf(found.text)
    } catch {
        // An unparseable module is one no type can be read out of, which is the same answer as one
        // that could not be found. A build must not fail over a classification it was only offering.
        return ''
    }
    const types = new TypeReader(tokens, found.path)
    for (const declared of declaredTypes(tokens, types)) {
        if (declared.name === binding.exported) return found.text.slice(declared.start, declared.end)
    }
    return ''
}

/**
 * The emitted parameter's type, which is the AUTHORED one through `Props<…>`.
 *
 * The author writes what a prop IS — `n: number` — and the position holding this component writes
 * every prop into a cell, so what arrives is `Cell<number>` and `{n + 1}` emits `n() + 1`. `Props` is
 * that mapping, and it is a TYPE rather than a rewrite here so the author's own type is what appears
 * in the error when a prop is passed wrongly; `component()` inverts it back at the call site.
 *
 * A component that never calls `props()` accepts none of its own, and the type says so — which is
 * what makes a mistyped prop an error at the CALL site, where the mistake is. `children` is there
 * whatever it declared, because children are what is written BETWEEN the tags rather than a prop
 * anybody passes, and only a `<slot/>` renders them. Deciding it by whether the file HAS a `<slot/>`
 * would read better and cost more than it is worth: a page and a layout both arrive as one
 * `ViewModule`, so the router has one type for the two of them, and a page that accepted strictly
 * nothing would not be assignable to it.
 */
function signature(declared: Props | null): string {
    if (declared === null) return CHILDREN
    const authored = declared.type === null ? 'Record<string, unknown>' : declared.type
    return `${PROPS_TYPE}<${authored}> & ${CHILDREN}`
}

const CHILDREN = '{ children?: unknown }'

/**
 * `Props` under a generated name, because `Props` is exactly what an author calls their own prop
 * type — `types/valid/props.abide` does — and a merged declaration is a compile error at the point the
 * emitted file is read, not where it was written. `$` is the house mark for a name this emitter made
 * up, as `$0` is for a hoisted read.
 */
const PROPS_TYPE = 'Props$'

/** What a declared prop MEANS to the emit — see `memberKinds`. */
type PropKind = 'cell' | 'keyed' | 'plain'

/**
 * What each member of the declared props type IS, read off its own TEXT.
 *
 * Syntactic, like every other decision about what counts as a cell: nothing in the emit path may need
 * a type-checker. Three answers, and the DEFAULT is `cell` — a prop is data the position writes into a
 * cell, so a member this cannot read at all still gets the common rule.
 *
 *   plain  a FUNCTION — `onclick: (e: Event) => void`, or the method shorthand. A callback is called,
 *          not read, and `@click={onclick}` would attach the cell rather than the handler
 *   keyed  a `KeyedMemo`/`KeyedChannel` handle, which a prop cell cannot stand in for: it is selected
 *          by args and its SLOT is the source
 *   cell   everything else, `State<T>` included — an existing source passes through the wrapping
 *          rather than being wrapped twice
 *
 * A function type reached through a NAME — `onclick: Handler` — reads as `cell` and is the one hole,
 * for the reason an imported props type has always had one: this file cannot resolve a name it cannot
 * see. Writing the arrow out is what says it is a callback.
 */
function memberKinds(declared: string): Map<string, PropKind> {
    const kinds = new Map<string, PropKind>()
    const from = declared.indexOf('{')
    if (from === -1) return kinds

    let depth = 0
    let quote = ''
    let member = ''
    // Members are separated by `;`, `,` or a newline, and only at the type body's own depth. A
    // comment between two of them is dropped here rather than confusing the match below.
    for (let i = from; i < declared.length; i++) {
        const char = declared[i] as string
        if (quote !== '') {
            if (char === '\\') i++
            else if (char === quote) quote = ''
            else member += char
            continue
        }
        if (char === '/' && declared[i + 1] === '/') {
            while (i < declared.length && declared[i] !== '\n') i++
            continue
        }
        if (char === '/' && declared[i + 1] === '*') {
            const close = declared.indexOf('*/', i + 2)
            i = close === -1 ? declared.length : close + 1
            continue
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char
            member += char
            continue
        }
        // `<`/`>` count because `Map<string, number>` holds a comma the split must not see. `=>` is
        // the exception the arrow makes: its `>` closes nothing.
        if (char === '>' && declared[i - 1] === '=') {
            member += char
            continue
        }
        if (char === '{' || char === '(' || char === '[' || char === '<') {
            depth++
            if (depth > 1) member += char
            continue
        }
        if (char === '}' || char === ')' || char === ']' || char === '>') {
            depth--
            if (depth === 0) break
            member += char
            continue
        }
        if (depth === 1 && (char === ';' || char === ',' || char === '\n')) {
            classifyMember(member, kinds)
            member = ''
            continue
        }
        member += char
    }
    classifyMember(member, kinds)
    return kinds
}

// `readonly` and `?` are noise to this question; an index signature and a call signature bind no name
// at all, so neither matches. The captured tail is what the member's type STARTS with.
const MEMBER = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*([:(<])\s*([\s\S]*)$/

function classifyMember(member: string, into: Map<string, PropKind>): void {
    const match = MEMBER.exec(member)
    if (match === null) return
    const name = match[1] as string
    // `onclick(e: Event): void` and `identity<T>(v: T): T` — the method shorthands.
    if (match[2] !== ':') {
        into.set(name, 'plain')
        return
    }
    const type = match[3] as string
    // The parenthesised head of an arrow, or a generic one.
    if (type.startsWith('(') || type.startsWith('<')) {
        into.set(name, 'plain')
        return
    }
    const constructed = /^([A-Za-z_$][\w$]*)\s*</.exec(type)
    const reactive = constructed === null ? undefined : REACTIVE_TYPES.get(constructed[1] as string)
    into.set(name, reactive === 'keyed' ? 'keyed' : 'cell')
}

/**
 * What each prop LOCAL is, which is the member's kind under the name the pattern gave it.
 *
 * Two facts meet here: the declared type says what a prop is, and the pattern says what it is called
 * here. Reading the type alone was wrong under a rename — `{ note: text }` left `text` a plain value
 * and made `text.length` the arity of a function, which type-checks and renders `0`.
 */
function propKinds(bound: Binding[], declared: string): Map<string, PropKind> {
    const members = memberKinds(declared)
    const kinds = new Map<string, PropKind>()
    for (const binding of bound) kinds.set(binding.local, members.get(binding.name) ?? 'cell')
    return kinds
}

/**
 * `props()` in a `<script module>`: module scope has no instance, so there are no props to bind.
 *
 * The SAME recogniser the setup block is read with, over the tokens `emit` already scanned for this
 * region. A regex over the raw text saw comments, strings and template text alike — a `<script module>`
 * holding only the comment `// props() must move to <script>` failed to compile.
 */
function checkNoProps(source: string, tokens: Token[], filename: string): void {
    const found = propsCall(source, tokens, new TypeReader(tokens))
    if (found === null) return
    throw new ParseError(
        `abide: props() in a <script module> (${filename}) — module scope is shared by every ` +
            `instance, so there are no props there. Move it to <script>.`,
        found.start,
    )
}

/**
 * Specifiers the emit compiles away, as `mergeImports` takes them: `${module} ${name}`.
 *
 * `props` and nothing else so far. `props<T>()` IS the parameter — the call is replaced by `args` and
 * the type argument becomes its annotation — so a surviving import would name a binding the emitted
 * module never reaches, and would break the count in the SPEC of what a compiled file may import from
 * `abide` on its own behalf. Declared beside the check that makes the import mandatory, so the two
 * halves of one rule sit together rather than one of them living inside the merger.
 */
const ERASED_IMPORTS: ReadonlySet<string> = new Set(['abide props'])

/**
 * `props` reached without being imported.
 *
 * The call is erased, so an unimported one would compile clean and quietly work — which is the one
 * thing this spelling exists to prevent. Named rather than inferred: an author who meant a `props` of
 * their own gets told which name collided.
 */
function checkPropsImported(imports: string[], at: number, filename: string): void {
    for (const statement of imports) {
        if (!/from\s*['"]abide['"]/.test(statement)) continue
        if (/\bprops\b/.test(statement.slice(0, statement.indexOf('from')))) return
    }
    throw new ParseError(
        `abide: props() is not imported (${filename}) — add it to the <script>'s ` +
            `\`import { … } from 'abide'\`, the way every other name it uses is.`,
        at,
    )
}

/**
 * The setup body with `props<T>()` replaced by the parameter, and every prop local bound to a cell.
 *
 * Two edits, and the second is the one the design turns on. The call becomes `args`, as it always
 * did. And each prop that is DATA moves out of the pattern — `{ class: className = '' }` becomes
 * `{ class: $className }`, with `const className = propCell($className, '')` after it — because a
 * prop arrives as a cell and a destructure default cannot survive that: a caller who omits the prop
 * satisfies the default with a plain string, leaving the local `'' | Cell<string>` where only one of
 * the two is callable. A default belongs beside the value it stands in for, so it goes to `propCell`.
 *
 * A FUNCTION prop and a KEYED handle are left in the pattern untouched, which is what `propKinds`
 * decided: neither is a cell, and neither may become one.
 */
function bindProps(rest: string, declared: Props, kinds: Map<string, PropKind>): string {
    let text = ''
    let cursor = 0
    let declarations = ''
    for (const binding of declared.bound) {
        if (kinds.get(binding.local) !== 'cell') continue
        text += rest.slice(cursor, binding.start)
        text += binding.renamed ? `$${binding.local}` : `${binding.name}: $${binding.local}`
        cursor = binding.end
        if (binding.fallback !== null) {
            text += rest.slice(cursor, binding.fallbackStart)
            cursor = binding.fallbackEnd
        }
        const fallback = binding.fallback === null ? '' : `, ${binding.fallback}`
        declarations += `\nconst ${binding.local} = propCell($${binding.local}${fallback})`
    }
    // After the statement's own `;` when it has one, so the emitted file does not carry an empty
    // statement between two declarations.
    let after = declared.end
    while (rest[after] === ' ' || rest[after] === '\t') after++
    if (rest[after] !== ';') after = declared.end
    else after++
    return `${text}${rest.slice(cursor, declared.start)}args${rest.slice(declared.end, after)}${declarations}${rest.slice(after)}`
}

interface Import {
    default: string | null
    namespace: string | null
    named: string[]
}

const IMPORT_FORM = /^import\s+(?:(type)\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/

/**
 * One import per module, however many blocks asked for it.
 *
 * A `<script module>` and a `<script>` may both `import { memo } from 'abide'`, and the compiler adds
 * its own `abide` import on top. Concatenating them redeclares the binding, which is a SyntaxError —
 * so the specifiers are merged rather than the statements stacked.
 *
 * `erased` names specifiers the emit has COMPILED AWAY, as `${module} ${name}`. A merger that knew
 * which ones those were would be a merger that has to be edited every time something new is erased;
 * the rule belongs to whatever did the erasing, and arrives here as data.
 */
function mergeImports(statements: string[], erased: ReadonlySet<string>): string {
    const byModule = new Map<string, Import>()
    const order: string[] = []
    let passthrough = ''

    for (const statement of statements) {
        const text = statement.trim()
        if (text === '') continue
        const match = IMPORT_FORM.exec(text)
        if (match === null) {
            // Something this merger does not model (a side-effecting form it did not recognise);
            // carrying it through unchanged is safer than dropping or rewriting it.
            passthrough += `${text}\n`
            continue
        }
        const module = (match[3] ?? match[4]) as string
        let entry = byModule.get(module)
        if (entry === undefined) {
            entry = { default: null, namespace: null, named: [] }
            byModule.set(module, entry)
            order.push(module)
        }
        // A bare `import 'x'` adds no specifier; the empty-clause arm below is what re-emits it.
        if (match[4] !== undefined) continue
        const typeOnly = match[1] !== undefined
        const clause = (match[2] ?? '').trim()
        const braces = /^([^{]*?)\s*,?\s*\{([\s\S]*)\}$/.exec(clause)
        const head = (braces === null ? clause : (braces[1] as string)).trim()
        if (head.startsWith('* as ')) entry.namespace ??= head.slice(5).trim()
        else if (head !== '') entry.default ??= head
        if (braces !== null) {
            for (const raw of (braces[2] as string).split(',')) {
                const name = raw.trim()
                if (name === '') continue
                // `import type { A }` folds into the inline `type A` spelling, which is what lets it
                // share a statement with a value import under `verbatimModuleSyntax`.
                const spelled = typeOnly && !name.startsWith('type ') ? `type ${name}` : name
                if (erased.has(`${module} ${spelled}`)) continue
                if (!entry.named.includes(spelled)) entry.named.push(spelled)
            }
        }
    }

    let out = ''
    for (const module of order) {
        const entry = byModule.get(module) as Import
        const clauses: string[] = []
        if (entry.default !== null) clauses.push(entry.default)
        if (entry.namespace !== null) clauses.push(`* as ${entry.namespace}`)
        if (entry.named.length > 0) clauses.push(`{ ${entry.named.join(', ')} }`)
        out +=
            clauses.length === 0 ? `import '${module}'\n` : `import ${clauses.join(', ')} from '${module}'\n`
    }
    return out + passthrough
}

/** Lift `import` statements to module scope — a `<script>` body is inlined into a function. */
function splitImports(
    source: string,
    from: number,
    to: number,
    tokens: Token[],
): { imports: string[]; rest: string } {
    const spans: { start: number; end: number }[] = []
    let pending: number | null = null
    let pendingAt = -1
    let sawFrom = false
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (pending === null) {
            if (token.kind !== SyntaxKind.ImportKeyword) continue
            // The token AFTER the keyword decides, not an offset from it. `import(` is a dynamic
            // import and `import.meta` is an expression; both stay where they are. Read as offsets
            // — `(` at exactly `start + 6` — the dot slipped past, `pending` outlived the line, and
            // the next `from` in the body (an `Array.from` will do) closed a span on the next
            // string: the statement was lifted to module scope with its own tail left behind.
            const next = tokens[i + 1]
            if (next === undefined) continue
            if (next.kind === SyntaxKind.DotToken || next.kind === SyntaxKind.OpenParenToken) continue
            pending = token.start
            pendingAt = i
            sawFrom = false
            continue
        }
        if (token.kind === SyntaxKind.FromKeyword) sawFrom = true
        // `i === pendingAt + 1` is the side-effect form, `import 'x'` — by TOKEN, so the whitespace
        // it was written with cannot change the answer.
        else if (token.kind === SyntaxKind.StringLiteral && (sawFrom || i === pendingAt + 1)) {
            spans.push({ start: pending, end: token.end })
            pending = null
        }
    }
    if (spans.length === 0) return { imports: [], rest: source.slice(from, to) }
    const imports: string[] = []
    let rest = ''
    let cursor = from
    for (const span of spans) {
        rest += source.slice(cursor, span.start)
        imports.push(source.slice(span.start, span.end))
        cursor = span.end
        if (source[cursor] === ';') cursor++
    }
    return { imports, rest: rest + source.slice(cursor, to) }
}

// --- expressions -----------------------------------------------------------

// Materialising the shadow-filtered environment is for `desugar`, which needs the two sets as
// arguments. A caller asking whether ONE name is live asks `liveCell`/`liveKeyed` instead: under a
// `{#for}`, a `{#component}` or a branch script the shadow is non-empty, so `live` allocates two
// sets and walks the whole environment — once per expression node and once per expression attribute
// in the emitter's per-node walk, half of it thrown away unread.
function live(context: Context): Reactive {
    if (context.shadow.size === 0) return context.reactive
    const cells = new Set<string>()
    for (const name of context.reactive.cells) if (!context.shadow.has(name)) cells.add(name)
    const keyed = new Set<string>()
    for (const name of context.reactive.keyed) if (!context.shadow.has(name)) keyed.add(name)
    return { cells, keyed }
}

/**
 * A named import from `server/rpc/**` is a KEYED MEMO, and an import statement is the only place that
 * fact can come from.
 *
 * `reactiveBindings` reads `NAME = memo(…)` out of the file's own tokens, and an rpc stub is never
 * written in the file: the module elides to `remote(id)`, and what comes back is a keyed memo by the
 * law the whole transport is — `rpc` = `memo` + transport, one slot per args. Without this the
 * caller's vocabulary is NOT identical on the two sides after all: `{#if orders({ id }).pending()}`
 * would not defer, because `deferrable` cannot see a source in the head, and `{orders({ id }).total}`
 * would be a member access on a handle rather than on the value.
 *
 * `server/sockets/**` is deliberately not here. A socket is keyed only in the ROOM form, and nothing
 * in an import statement says which of the two this one is.
 */
function rpcImports(statements: string[], into: Reactive): void {
    for (const statement of statements) {
        const match = IMPORT_CLAUSE.exec(statement)
        if (match === null) continue
        const clause = match[1] as string
        // `import type { … }` carries no value at all, so nothing it names is a source.
        if (clause.startsWith('type ')) continue
        // `kindOf` is the one place that says which transport a module declares, so this cannot
        // drift from what `elide` does with the same specifier. The leading slash makes a bare
        // `server/rpc/x.ts` match on the same test a relative `../../server/rpc/x.ts` does. A
        // socket answers `'socket'` here rather than falling through unnamed — see above for why
        // that is not keyed.
        if (kindOf(`/${match[2] as string}`) !== 'rpc') continue
        const open = clause.indexOf('{')
        if (open === -1) continue
        for (const entry of clause.slice(open + 1, clause.lastIndexOf('}')).split(',')) {
            const trimmed = entry.trim()
            if (trimmed === '' || trimmed.startsWith('type ')) continue
            // `a as b` binds `b`; a bare `a` binds itself.
            const renamed = trimmed.lastIndexOf(' as ')
            const local = renamed === -1 ? trimmed : trimmed.slice(renamed + 4).trim()
            if (IDENTIFIER.test(local)) into.keyed.add(local)
        }
    }
}

const IMPORT_CLAUSE = /^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*$/

function liveCell(context: Context, name: string): boolean {
    return context.reactive.cells.has(name) && !context.shadow.has(name)
}

function liveKeyed(context: Context, name: string): boolean {
    return context.reactive.keyed.has(name) && !context.shadow.has(name)
}

/**
 * Where an expression is going, which decides what it may become.
 *
 * Naming a cell alone HANDS OVER the cell rather than reading it — that is what `bind:value={x}`,
 * `&ref` and a component prop need, and a child slot renders it as its value anyway because `unwrap`
 * reads a slot's cell one step further.
 *
 *   read  composed into something BIGGER — a condition, a class toggle, an interpolated attribute —
 *         where the cell itself is never the useful thing
 *   slot  a child slot, which renders whatever it is given. The cell is fine, but an enclosing
 *         condition's hoisted local is BETTER: the outer thunk already subscribes to that cell, so a
 *         second subscription inside the branch only wakes twice for one change
 *   cell  `bind:`, `&ref`, a component prop — these need the cell ITSELF, so a hoisted value would be
 *         the wrong thing entirely, not merely a coarser one
 */
type Position = 'read' | 'slot' | 'cell'

function code(expr: Expr, context: Context, position: Position = 'read'): string {
    const hoisted = position === 'cell' ? NO_HOIST : context.hoisted
    // The bare-cell case — `{count}`, the common slot — answers off two `has` calls and never
    // reaches `desugar`, so the sets it would have taken are not built for it.
    if (IDENTIFIER.test(expr.source) && liveCell(context, expr.source)) {
        const local = hoisted.get(expr.source)
        if (local !== undefined) return local
        return position === 'read' ? `${expr.source}()` : expr.source
    }
    const names = live(context)
    return desugar(context.source, expr.start, expr.start + expr.source.length, names.cells, {
        keyed: names.keyed,
        hold: position !== 'read',
        hoisted,
    }).text
}

/**
 * Take a condition's reads into locals, so the branch bodies narrow off them.
 *
 * TypeScript narrows a `const` and never a call — and every abide read IS a call, so
 * `{#if session}{session.name}{/if}` had no way to typecheck: the test and the use were two separate
 * `session()` calls with nothing tying them together. Reading once and sharing the local is the whole
 * fix, and it also costs LESS: separate reads subscribe to the same cell twice and both wake on a
 * change, where one hoisted read wakes the branch once.
 *
 * Only the condition's OWN reads are hoisted. A body that reads something else keeps its own thunk,
 * so `{#if mode}{count}{/if}` still wakes on `count` alone.
 */
function hoistReads(
    expr: Expr,
    context: Context,
): { declarations: string[]; scope: Map<string, string>; text: string } {
    const names = live(context)
    // The TEXT comes back with the reads, and both are the same pass. Keeping only `.reads` meant
    // every `{#if}`, `{:else if}` and `{#switch}` head was desugared twice — a second tokenize, a
    // second `typeRegions` with its own `TypeReader`, and both walks — to recover text this pass had
    // already produced. Reusable only where the hoisted scope did NOT change under it, which is what
    // `declarations.length === 0` says; the callers check that rather than this function guessing.
    const pass = desugar(context.source, expr.start, expr.start + expr.source.length, names.cells, {
        keyed: names.keyed,
        hoisted: context.hoisted,
    })
    const found = pass.reads

    const scope = new Map(context.hoisted)
    const declarations: string[] = []
    // A read INSIDE another read is already captured by it — `details({ title })` holds `title`, so
    // hoisting both would rewrite the argument inside a span that has been replaced wholesale.
    let covered = -1
    for (const read of found) {
        if (read.start < covered) continue
        covered = read.end
        if (scope.has(read.key)) continue
        const local = `$${context.counter.n++}`
        const code = read.keyed
            ? `${desugar(context.source, read.start, read.end, names.cells, { keyed: names.keyed, hold: true, hoisted: context.hoisted }).text}()`
            : `${read.key}()`
        declarations.push(`const ${local} = ${code}`)
        scope.set(read.key, local)
    }
    return { declarations, scope, text: pass.text }
}

function withHoists(context: Context, scope: Map<string, string>): Context {
    return { ...context, hoisted: scope }
}

/** The positions that need the cell itself: `bind:`, `&ref`, a component prop. */
function held(expr: Expr, context: Context): string {
    return code(expr, context, 'cell')
}

const PLAIN_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/

/**
 * Emitted text that can be pasted into a LARGER expression without parentheses: a path, or a number
 * or string literal.
 *
 * A separate question from `unthunked`'s, and the two must not be confused again. `unthunked` asks
 * whether an expression can READ a source — `a ?? b` cannot, so it answers yes — while a caller
 * interpolating text into `${x} === ${y} ? … : …` is asking whether the text BINDS tightly enough.
 * `{#switch a ?? b}` inlined that way emits `a ?? b === 'x' ? … : …`, which JavaScript parses as
 * `a ?? (b === 'x')`: wrong branch, no error, and nothing a type-check can see.
 */
const ATOMIC =
    /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|-?\d+(?:\.\d+)?|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")$/

/** Characters that could begin an operator binding LOOSER than the `===` / `?:` an operand goes into. */
const LOOSE = /[?:|&=<>+\-*/%^~!,]/

/**
 * The same text, safe in an operand position.
 *
 * Parenthesised unless nothing at the TOP level could form an operator — a path, a literal, a call
 * and an index all qualify, because their brackets are depth rather than operators, and a call
 * already binds tighter than anything it would be pasted beside. Scanned rather than pattern-matched
 * because the question is about nesting: `f(a ? b : c)` is safe and `a ? b : c` is not, and no regex
 * tells those apart.
 */
function operand(emitted: string): string {
    let depth = 0
    let quote = ''
    for (let i = 0; i < emitted.length; i++) {
        const char = emitted[i] as string
        if (quote !== '') {
            if (char === '\\') i++
            else if (char === quote) quote = ''
            continue
        }
        if (char === '"' || char === "'" || char === '`') quote = char
        else if (char === '(' || char === '[' || char === '{') depth++
        else if (char === ')' || char === ']' || char === '}') depth--
        // `?.` is optional chaining, which is part of the path rather than an operator over it.
        else if (char === '?' && emitted[i + 1] === '.') i++
        else if (depth === 0 && LOOSE.test(char)) return `(${emitted})`
    }
    return emitted
}

/**
 * Anything that could EVALUATE something when the slot is read: a call, a tagged or plain template
 * literal, or a function literal. `=>` and `function` are here for a different reason than `(` — a
 * function reaching a slot or an attribute is DATA the binder would call, so leaving one unthunked
 * would change what it means, not merely when it runs.
 */
const EVALUATES = /[(`]|=>|\bfunction\b/

/**
 * Whether an emitted slot expression can go in WITHOUT its thunk.
 *
 * The test is on what `code` PRODUCED, not on what the author wrote, and that is what makes it both
 * safe and complete. `code` has already resolved the position: a cell in a child slot comes back as
 * `count` — a value the slot reads for itself — while the same cell in an attribute comes back as
 * `count()`, which has a call and stays deferred. A `{#if}`'s hoisted read comes back as `$0`, a
 * plain const, wherever it appears. One rule answers all three, so no position argument is needed.
 *
 * CALL-FREE is the load-bearing half: `{helper()}` where `helper` reads a cell IS reactive, and
 * nothing about the expression says so. `{session.name}` is a read too, and comes back as
 * `session().name` — a call, so it is excluded by the same test rather than by a second one. The
 * converse is why the test is not "is a plain path": every read this compiler EMITS is a call, so
 * call-free text mentions no cell this compiler knows about — `{TONE[row.kind]}` and `{a ? b : c}`
 * over a `{#for}` binding are as unreactive as `{$0}` is, and thunking them bought one effect per
 * row that can never wake plus the array holding it.
 *
 * Where that converse STOPS, because it was tried one step further and does not hold: "reads no cell
 * this compiler emitted" is not "runs no code". A member access can reach a getter — `view.big` over
 * `get big() { return n() > 3 }` is call-free text that reads a cell — so an unthunked expression is
 * only as safe as the effect it is evaluated inside. Everywhere a template literal is built that is
 * some enclosing effect, so the wake is wider than it should be and the screen stays right; the
 * exception is a `{:catch}`/`{:finally}` arm or a `{#for await}` row, which a promise continuation
 * calls with no tracking context at all. That is why BLOCKS keep their thunks whatever their head
 * reads: dropping them was measured, and it made a bare `{#if}` inside a deferred arm stop updating,
 * and elsewhere widened the wake enough to throw a settled block back to its placeholder.
 * `{a.b.c}` in a slot has always been unthunked, so this limit is the model's, not this rule's.
 *
 * The trade, stated: an unthunked expression is evaluated where the `html` tag is, so a throw inside
 * it surfaces during render rather than inside the slot's own effect — already true of `{a.b.c}` and
 * of everything inside a `{#try}`.
 */
function unthunked(emitted: string, context: Context): boolean {
    if (EVALUATES.test(emitted)) return false
    // A keyed memo named alone is its HANDLE — `m` is not `m(args)` — so it is not a value to render.
    // Only a bare path can be that: anything else has composed the name into something else.
    if (!PLAIN_PATH.test(emitted)) return true
    const dot = emitted.indexOf('.')
    return !liveKeyed(context, dot < 0 ? emitted : emitted.slice(0, dot))
}

/** Record a runtime helper the emitted file turned out to need, so the header imports it. */
function need(context: Context, name: Runtime): Runtime {
    context.used.add(name)
    return name
}

/**
 * Static text, escaped for the template literal it is being pasted into.
 *
 * Escaping ONLY — an attribute value comes through here too (`interpolate`), and `<!--` inside one is
 * four characters of the value rather than a comment. Dropping comments is `child`'s job, where the
 * text is known to be markup.
 */
function literal(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

// --- children --------------------------------------------------------------

function children(nodes: Node[], context: Context): string {
    const inner = subtreeScoped(nodes, context)
    let out = ''
    for (const node of nodes) out += child(node, inner)
    return out
}

/**
 * A nested `<style>` scopes the nodes it sits among and everything under them — its SIBLINGS, not the
 * element that holds them, which is what makes "an outer rule reaches in and an inner one cannot
 * reach out" true in both directions at once: the outer attribute is on every element here, the inner
 * one only on these.
 *
 * Every list of children asks, so the rule holds inside an element and inside a block body without
 * either one knowing about it. The common case is no block at all, and it costs one `kind` compare
 * per node and no allocation.
 */
function subtreeScoped(nodes: Node[], context: Context): Context {
    let css = ''
    let found = false
    for (const node of nodes) {
        if (node.kind !== 'style') continue
        found = true
        css += node.body
    }
    if (!found) return context

    const attribute = registerSheet(css, context)
    // Already in force — the same rules, reached by the same attribute. A second copy of it in the
    // tag would be a duplicate attribute in the markup, and the sheet is one either way.
    const inForce = context.scope
    if (inForce === null) return { ...context, scope: attribute }
    if (inForce.includes(attribute)) return context
    return { ...context, scope: `${inForce} ${attribute}` }
}

/** A static array at module scope, shared by every element that spells the same one. */
function liftArray(elements: string, context: Context): string {
    const literal = `[${elements}]`
    let name = context.lifted.get(literal)
    if (name === undefined) {
        name = `$lifted${context.lifted.size}`
        context.lifted.set(literal, name)
    }
    return name
}

/**
 * One block into the module-scope registry, and back out as the attribute its elements carry.
 *
 * Content-addressed, so two blocks spelling the same rules — in one file or across a subtree and the
 * component around it — share one sheet and one attribute rather than fighting over the cascade.
 */
function registerSheet(css: string, context: Context): string {
    const name = scopeName(context.filename, css)
    const attribute = `data-a${name}`
    if (!context.sheets.has(name)) {
        const scoped = JSON.stringify(scopeCss(css, attribute))
        context.sheets.set(name, `${need(context, 'adopt')}('${name}', ${scoped})\n`)
    }
    return attribute
}

/**
 * A slot's value: deferred behind a thunk normally, evaluated in place inside a `{#try}`.
 *
 * A thunk IS a deferral — `html`${() => f()}`` stores the arrow and never calls it, so a `try` around
 * the tagged template sees nothing and the throw surfaces later inside the slot's own effect. Inside
 * a boundary everything is evaluated while the body runs, which is the only way the boundary's
 * `catch` is reachable at all.
 */
function slot(value: string, context: Context): string {
    return context.eager ? `\${${value}}` : `\${() => ${value}}`
}

/**
 * An expression as the BODY of an arrow.
 *
 * `() => { a: count() }` is an arrow with a block body holding a labelled statement, not an arrow
 * returning an object — so `{a: cell}` in a slot, an attribute or a spread rendered nothing, applied
 * nothing and set nothing, silently. Only a leading `{` can do this, so only a leading `{` is
 * parenthesised.
 *
 * Applied at the two sites an author's own expression reaches an arrow body — a child slot and an
 * element's attribute, both BEFORE the source marker goes on, since the marker would otherwise be
 * the first character — plus the spread, which carries no marker. `slot()` does not apply it: every
 * caller hands it marked text or a runtime call.
 */
function body(value: string): string {
    return value.startsWith('{') ? `(${value})` : value
}

/** The same, for a producer that is already a thunk. */
function called(thunk: string, context: Context): string {
    return context.eager ? `\${(${thunk})()}` : `\${${thunk}}`
}

function child(node: Node, context: Context): string {
    switch (node.kind) {
        case 'text':
            // A `.abide` file's own commentary is for whoever opens the file, and emitting it ships
            // one copy PER INSTANCE: the dogfood app's card and source panes were 22.7 kB of a single
            // 88 kB page that way, against 1.9 kB for every hydration marker on it. Dropped here
            // rather than in the parser, so `check` still points a diagnostic at what a human wrote —
            // and dropped ONCE, so both lanes agree: the two substrates read this one emitted
            // template, and a comment absent from the client's markup is absent from the server's.
            return literal(node.value.replace(HTML_COMMENT, ''))
        case 'expression': {
            const value = code(node.value, context, 'slot')
            // `{raw(...)}` is SPEC's escape hatch, and the author wrote the call — so nothing is
            // rewritten here. `need` is only what puts `raw` in the header for a file that reached
            // for the hatch without importing it, the same way `html` is handled.
            if (node.raw) need(context, 'raw')
            // Parenthesised BEFORE the marker goes on, since the marker is a prefix and `body` reads
            // the first character of the expression.
            const marked = mark(node.value.start, body(value))
            // Nothing here can read a source, or it IS one — either way the thunk would only cost.
            if (unthunked(value, context)) return `\${${marked}}`
            // Inside a `{#try}` the boundary is one unit, so nothing gets its own thunk.
            return slot(marked, context)
        }
        case 'element':
            return element(node, context)
        case 'component':
            return slot(invoke(node, context), context)
        case 'slot': {
            const held = context.children
            if (held === null) {
                throw new ParseError(
                    `abide: <slot/> has no children to render — the enclosing {#component} destructures ` +
                        `its parameter without binding \`children\`. Name the parameter instead ` +
                        `(\`(props: {…})\`), or destructure \`children\` out of it.`,
                    node.start,
                )
            }
            // The same test the expression arm makes, and it passes: the children are a plain path
            // the CALLER already built eagerly, never a source. Thunked, every instance of every
            // component with a `<slot/>` paid an effect — plus the slot-effect array holding it —
            // for a subscription that can never wake, and a component inside a `{#for}` paid it per
            // row. A function handed in from JS is still deferred: the part treats a function child
            // value as a thunk, which is the same mechanism `unthunked` relies on for a bare cell.
            return unthunked(held, context) ? `\${${held}}` : slot(held, context)
        }
        case 'script':
            // A `<script>` never reaches here when it is where it may be: the component's own two are
            // lifted by `parse`, and a branch-local one is taken by `scoped` off the FRONT of its
            // body. So one that arrives is nested inside an element, where `scoped` cannot see it —
            // and returning '' for it dropped the declarations on the floor while leaving every use
            // of them in the markup, which is a file that emits and then fails on a name nothing
            // declared. `scoped` raises the sibling case; this is the same rule one level down.
            throw new ParseError(
                'abide: a <script> nested inside an element has nowhere to put its declarations — ' +
                    "the component's own goes at the top level, and a block-local one must be the " +
                    'FIRST node of its block body',
                node.start,
            )
        case 'style':
            // Lifted into the module-scope registry `subtreeScoped` already wrote it to.
            return ''
        // `conditional` and `switched` hand back a whole thunk, since an else-if chain needs a body
        // rather than an expression.
        case 'if':
            return called(conditional(node.branches, context), context)
        case 'switch':
            return called(switched(node, context), context)
        case 'for':
            return slot(loop(node, context), context)
        case 'try':
            return slot(guarded(node, context), context)
        case 'define':
            return ''
    }
}

/** A body as one `html` template, so it can sit in a branch arm. */
function fragment(nodes: Node[], context: Context): string {
    const branch = scoped(nodes, context)
    const inner = children(branch.rest, branch.context)
    const markup = inner.trim() === '' ? 'null' : `${need(context, 'html')}\`${inner}\``
    if (branch.statements === '') return markup
    // A branch-local `<script>` in a position that is not already a closure. `{#for}` splices its
    // statements straight into the row closure it already has; everywhere else pays one call.
    return `(() => {${branch.statements}return ${markup} })()`
}

interface Scoped {
    statements: string
    context: Context
    rest: Node[]
}

/**
 * A branch-local `<script>`: statements for the level's own closure, and a scope its body resolves
 * against.
 *
 * It must be the FIRST node of the body (SPEC) — anywhere else and the bindings would be used above
 * their declaration. It carries no `import`, because it reuses the component's, and because an import
 * inside a branch has nowhere to be hoisted TO.
 */
function scoped(nodes: Node[], context: Context): Scoped {
    let first = -1
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i] as Node
        // Whitespace and comments are not nodes anyone means; a comment explaining the script sits
        // above it far more often than not. A nested `<style>` is not one either — it declares
        // nothing and is lifted out of the markup, so ordering it against the script is a rule with
        // no consequence behind it.
        if (node.kind === 'text' && node.value.replace(HTML_COMMENT, '').trim() === '') continue
        if (node.kind === 'style') continue
        first = i
        break
    }
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i] as Node
        if (node.kind === 'script' && i !== first) {
            throw new ParseError(
                'abide: a branch-local <script> must be the FIRST node of its block body',
                node.start,
            )
        }
    }
    const leading = first < 0 ? undefined : (nodes[first] as Node)
    if (leading === undefined || leading.kind !== 'script') {
        return { statements: '', context, rest: nodes }
    }

    const from = leading.start
    const to = from + leading.body.length
    const tokens = tokensOf(context.source, from, to)
    forbidKeyword(
        tokens,
        SyntaxKind.ImportKeyword,
        'abide: a branch-local <script> carries no `import` — it reuses the component’s',
    )

    // A nested level gets its OWN view of what is reactive: a cell declared here exists only inside
    // the branch, and a plain binding that reuses an outer cell's name has to shadow it — otherwise
    // `{count}` in the body would still compile to a read of the outer cell.
    // What THIS script declares, kept separate from what it inherits. Asking whether the inherited
    // set already holds a name answers the wrong question: `const rate = …` shadowing an outer
    // `rate` source would look like a name that is already reactive, and the shadow would be dropped.
    const own: Reactive = { cells: new Set(), keyed: new Set() }
    reactiveBindings(tokens, own)

    const reactive: Reactive = {
        cells: new Set(context.reactive.cells),
        keyed: new Set(context.reactive.keyed),
    }
    const shadow = new Set(context.shadow)
    for (const name of declaredNames(tokens)) {
        if (own.cells.has(name)) {
            reactive.cells.add(name)
            shadow.delete(name)
        } else if (own.keyed.has(name)) {
            reactive.keyed.add(name)
            shadow.delete(name)
        } else {
            // A plain binding. It hides whatever the name meant outside, source or not.
            shadow.add(name)
        }
    }

    const inner: Context = { ...context, reactive, shadow }
    const statements = desugar(context.source, from, to, reactive.cells, {
        expression: false,
        keyed: reactive.keyed,
    }).text
    // Newlines are KEPT. Collapsing them onto one line drops the semicolons ASI was relying on, and
    // `const total = a + b return …` is a syntax error rather than a formatting complaint.
    return {
        statements: `\n${statements.trim()}\n`,
        context: inner,
        rest: nodes.filter((_, index) => index !== first),
    }
}

/** Names a `<script>` declares at any depth, which is what has to shadow an outer source. */
function declaredNames(tokens: Token[]): string[] {
    const names: string[] = []
    let expecting = false
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (
            token.kind === SyntaxKind.ConstKeyword ||
            token.kind === SyntaxKind.LetKeyword ||
            token.kind === SyntaxKind.VarKeyword ||
            token.kind === SyntaxKind.FunctionKeyword
        ) {
            expecting = true
            continue
        }
        if (!expecting) continue
        if (token.kind === SyntaxKind.Identifier) names.push(token.text)
        // A destructuring pattern keeps declaring until its brace closes; anything else ends it.
        if (token.kind !== SyntaxKind.OpenBraceToken && token.kind !== SyntaxKind.OpenBracketToken) {
            if (token.kind !== SyntaxKind.CommaToken && token.kind !== SyntaxKind.Identifier) {
                expecting = false
            }
        }
    }
    return names
}

// --- elements --------------------------------------------------------------

function element(
    node: { name: string; attributes: Attribute[]; children: Node[] },
    context: Context,
): string {
    // The scope attribute is STATIC markup, so a scoped component costs nothing per render — the
    // template carries it the way it carries a class.
    let open = context.scope === null ? `<${node.name}` : `<${node.name} ${context.scope}`
    // Narrowed on push, so the pair lists below read `name`/`value` without a cast.
    const classToggles: { name: string; value: Expr }[] = []
    const styleToggles: { name: string; value: Expr }[] = []
    let staticClass = ''
    let staticStyle = ''
    let staticValue: string | null = null

    for (const attribute of node.attributes) {
        if (attribute.kind === 'class') classToggles.push(attribute)
        else if (attribute.kind === 'style') styleToggles.push(attribute)
        else if (attribute.kind === 'static' && attribute.name === 'class') staticClass = attribute.value
        else if (attribute.kind === 'static' && attribute.name === 'style') staticStyle = attribute.value
        else if (attribute.kind === 'static' && attribute.name === 'value') staticValue = attribute.value
    }

    for (const attribute of node.attributes) {
        switch (attribute.kind) {
            case 'static':
                // Held back when a toggle owns the whole attribute.
                if (attribute.name === 'class' && classToggles.length > 0) break
                if (attribute.name === 'style' && styleToggles.length > 0) break
                open += ` ${attribute.name}="${attribute.value.replace(/"/g, '&quot;')}"`
                break
            case 'expression': {
                const emitted = code(attribute.value, context)
                const marked = mark(attribute.value.start, body(emitted))
                open += unthunked(emitted, context)
                    ? ` ${attribute.name}=\${${marked}}`
                    : ` ${attribute.name}=\${() => ${marked}}`
                break
            }
            case 'interpolated': {
                const joined = interpolate(attribute.parts, context)
                open += joined.reads
                    ? ` ${attribute.name}=\${() => \`${joined.text}\`}`
                    : ` ${attribute.name}=\${\`${joined.text}\`}`
                break
            }
            case 'event':
                open += ` @${attribute.name}=\${${mark(attribute.value.start, code(attribute.value, context))}}`
                break
            case 'spread': {
                // Asks like its `expression`/`interpolated` siblings: a spread whose object reads
                // nothing cannot wake, so the thunk bought a closure, a graph node and an observer
                // set per row — and, being fresh per pass, defeated the slot's identity cutoff too.
                const emitted = code(attribute.value, context)
                open += unthunked(emitted, context)
                    ? ` ...=\${${body(emitted)}}`
                    : ` ...=\${() => ${body(emitted)}}`
                break
            }
            case 'bind':
                open += bind(attribute, node.name, staticValue, context)
                break
            case 'class':
            case 'style':
                break
        }
    }

    if (classToggles.length > 0) open += toggled(classToggles, staticClass, 'class', 'classes', context)
    if (styleToggles.length > 0) open += toggled(styleToggles, staticStyle, 'style', 'styles', context)

    if (node.children.length === 0 && VOID_ELEMENTS.has(node.name.toLowerCase())) return `${open} />`
    return `${open}>${children(node.children, context)}</${node.name}>`
}

/**
 * A `class:`/`style:` toggle group, emitted as the one attribute it owns.
 *
 * The names are STATIC and the conditions are not, so they are emitted apart: the array is lifted to
 * module scope once and the wake allocates only the rest array. Built as one pass rather than two
 * `.map`s over the same toggles.
 *
 * …and the thunk is only kept when a condition can actually READ. The two sibling attribute cases in
 * `element` both ask; these did not, so `<b class:on={row.flag}>` inside a `{#for}` cost a closure, a
 * graph node and its observer set per row for a wake that cannot happen.
 */
function toggled(
    toggles: { name: string; value: Expr }[],
    base: string,
    attribute: 'class' | 'style',
    helper: Runtime,
    context: Context,
): string {
    let names = ''
    let conditions = ''
    let reads = false
    for (const toggle of toggles) {
        const emitted = code(toggle.value, context)
        if (!unthunked(emitted, context)) reads = true
        names += `${names === '' ? '' : ', '}${JSON.stringify(toggle.name)}`
        conditions += `, ${emitted}`
    }
    const call = `${need(context, helper)}(${JSON.stringify(base)}, ${liftArray(names, context)}${conditions})`
    return ` ${attribute}=\${${reads ? `() => ${call}` : call}}`
}

/**
 * Where each `bind:` is legal, and what says the user changed it.
 *
 * A bind is a read AND a write, so it needs BOTH halves to exist on the element it is written on —
 * and this table is what makes that a compile error rather than a listener that never fires. It used
 * to be a bare tag→type map with one hand-written refusal beside it for `bind:selected`, so every
 * other wrong pairing compiled: `bind:open` on a `<details>` emitted an `@input` listener for an
 * event `<details>` does not have, cast to `HTMLElement`, which has no `.open` — three defects, none
 * of them reported here. The `selected` refusal was the shape of the answer; it was one row of it.
 *
 * `element` is deliberately absent: it is a node ref rather than a value, so it has no event and is
 * legal anywhere.
 */
const BINDABLE: Record<string, Record<string, { dom: string; event: string }>> = {
    value: {
        input: { dom: 'HTMLInputElement', event: 'input' },
        textarea: { dom: 'HTMLTextAreaElement', event: 'input' },
        // `change` and not `input`: a select fires `input` too, but `change` is the one that means
        // the selection settled, and it is what every arm of this ever emitted.
        select: { dom: 'HTMLSelectElement', event: 'change' },
    },
    checked: { input: { dom: 'HTMLInputElement', event: 'change' } },
    group: { input: { dom: 'HTMLInputElement', event: 'change' } },
    open: { details: { dom: 'HTMLDetailsElement', event: 'toggle' } },
}

/** A boolean PROPERTY mirrored as a boolean attribute: present iff truthy, never stringified. */
const BOOLEAN_BINDS = new Set(['checked', 'open'])

/**
 * What to write INSTEAD, for the spellings somebody reaches for before the one that works.
 *
 * A refusal that only says no makes the author guess, and the guess for `bind:selected` is to give
 * up on the select. Kept as a table rather than as an arm inside `bind` so that the next one is a
 * line here and not a fourth special case — see the rule about three of them.
 */
const INSTEAD: Record<string, string> = {
    selected:
        ' — a selection belongs to the `<select>`: write `bind:value` there and give each `<option>` its own `value="…"`',
}

/** `reads` is whether ANY hole is live — one is enough to make the joined string move. */
interface Interpolated {
    text: string
    reads: boolean
}

function interpolate(parts: (string | Expr)[], context: Context): Interpolated {
    let text = ''
    let reads = false
    for (const part of parts) {
        if (typeof part === 'string') {
            text += literal(part)
            continue
        }
        const emitted = code(part, context)
        if (!unthunked(emitted, context)) reads = true
        text += `\${${emitted}}`
    }
    return { text, reads }
}

/** `bind:value={x}` is a read AND a write, which is two slots on the same element. */
function bind(
    attribute: { target: string; value: Expr | null },
    tag: string,
    own: string | null,
    context: Context,
): string {
    const key_ = attribute.target
    // `bind:value` with no value binds the cell of the same name — `bind:value={value}` written once.
    const source =
        attribute.value === null
            ? key_
            : IDENTIFIER.test(attribute.value.source)
              ? attribute.value.source
              : held(attribute.value, context)

    // The node itself, not a value — nothing to serialise, so SSR emits nothing for it.
    if (key_ === 'element') return ` &ref=\${${source}}`

    // BOTH halves have to exist on this element, and the message says which one does not: a bind
    // nothing can write back from is a control that reads correctly and then never moves again.
    const where = BINDABLE[key_]
    const at = attribute.value?.start ?? 0
    if (where === undefined) {
        const known = Object.keys(BINDABLE).join('`, `bind:')
        throw new ParseError(
            `abide: there is no \`bind:${key_}\`${INSTEAD[key_] ?? ''}. The binds are ` +
                `\`bind:${known}\`, and \`bind:element\` for the node itself`,
            at,
        )
    }
    const legal = where[tag]
    if (legal === undefined) {
        const tags = Object.keys(where)
            .map((name) => `<${name}>`)
            .join(', ')
        throw new ParseError(
            `abide: \`bind:${key_}\` is for ${tags}${INSTEAD[key_] ?? ''} — a <${tag}> has no ` +
                `\`${key_}\` to read and no event to write one back from`,
            at,
        )
    }

    // The emitted listener is type-checked like any other code, so its parameter carries the type
    // the element actually has — an untyped `event` here is an implicit `any` in the author's build.
    const target = (property: string): string => `(event.currentTarget as ${legal.dom}).${property}`

    // `{get, set}` — an explicit accessor pair rather than a cell.
    const accessor = source.startsWith('{')
    const read = accessor ? `(${source}).get()` : `${source}()`
    const write = (value: string): string =>
        accessor ? `(${source}).set(${value})` : `${source}.set(${value})`

    if (BOOLEAN_BINDS.has(key_)) {
        // A boolean DOM property mirrored as a boolean ATTRIBUTE: present iff truthy, never
        // stringified — which is why the attribute slot is handed the raw boolean, and what makes
        // the state survive SSR. `checked` and `open` differ only in the event, which the table
        // above already carries, so this is one arm rather than the second copy of one.
        return (
            ` .${key_}=\${() => !!${read}}` +
            ` ${key_}=\${() => !!${read}}` +
            ` @${legal.event}=\${(event: Event) => ${write(target(key_))}}`
        )
    }

    if (key_ === 'group') {
        // Membership, compared against the input's OWN value — and never emitted as a `group`
        // attribute, because there is no such attribute.
        if (own === null) {
            throw new ParseError(
                'abide: bind:group compares against the input’s own `value`, so the element needs a ' +
                    'literal `value="…"`',
                attribute.value?.start ?? 0,
            )
        }
        const mine = JSON.stringify(own)
        // Read ONCE into a local in each half. `sources` has no dedupe, so a thunk reading the same
        // cell twice pushes two entries onto the slot's effect and every later re-run walks both,
        // doing an `observers.delete` that misses — and a group is N inputs on ONE cell, so it was
        // 2N. The same collapse `{#if}` and `{#switch}` conditions already make.
        const next =
            `Array.isArray(held)` +
            ` ? (${target('checked')} ? [...held, ${mine}] : held.filter((v: unknown) => v !== ${mine}))` +
            ` : ${mine}`
        return (
            ` .checked=\${() => { const held = ${read}; return Array.isArray(held) ? held.includes(${mine}) : held === ${mine} }}` +
            ` @${legal.event}=\${(event: Event) => { const held = ${read}; ${write(next)} }}`
        )
    }

    // The CELL itself where the source is one, not a thunk that reads it: a property slot's function
    // value goes through `unwrap`, which reads a source one step further, so the two are the same
    // write on both substrates — and the thunk was a fresh closure per bound input per row. The
    // exceptions are the arms above and are exactly why they are arms: an accessor pair is not a
    // cell, and a boolean needs the `!!` coercion for the attribute half. A `<select>` lands HERE —
    // `.value` plus the `change` the table names for it — which is why it has no arm of its own.
    const value = accessor ? `() => ${read}` : source
    return ` .${key_}=\${${value}}` + ` @${legal.event}=\${(event: Event) => ${write(target(key_))}}`
}

// --- components ------------------------------------------------------------

function invoke(node: { name: string; attributes: Attribute[]; children: Node[] }, context: Context): string {
    const props: string[] = []
    let spread = false
    for (const attribute of node.attributes) {
        switch (attribute.kind) {
            case 'static':
                props.push(`${key(attribute.name)}: ${JSON.stringify(attribute.value)}`)
                break
            case 'expression':
                props.push(`${key(attribute.name)}: ${held(attribute.value, context)}`)
                break
            case 'interpolated':
                props.push(`${key(attribute.name)}: \`${interpolate(attribute.parts, context).text}\``)
                break
            case 'event':
                // No element to attach to, so it is an ordinary prop the component places itself.
                props.push(`on${attribute.name}: ${held(attribute.value, context)}`)
                break
            case 'spread':
                props.push(`...${held(attribute.value, context)}`)
                spread = true
                break
            case 'bind': {
                const source = attribute.value === null ? attribute.target : held(attribute.value, context)
                props.push(`${key(attribute.target)}: ${source}`)
                break
            }
            case 'class':
            case 'style':
                throw new ParseError(
                    `abide: ${attribute.kind}:${attribute.name} is for ELEMENTS — <${node.name}> is a ` +
                        `component, so pass a prop instead`,
                    attribute.value.start,
                )
        }
    }

    // A nested `{#component X()}` inside the children becomes X's prop, not content.
    const content: Node[] = []
    for (const item of node.children) {
        if (item.kind === 'define') props.push(`${key(item.name)}: ${define(item, context)}`)
        else content.push(item)
    }
    // `children` is emitted whatever the tag was given, `undefined` included — `signature()` appends
    // it to every component's props type unconditionally, and omitting it here made one component a
    // different hidden class per call site, all landing on the same `args.children` read inside it.
    // A component invoked from inside a `{#for}` builds this literal per row. The exception is a
    // `...spread`, which is emitted BEFORE this and may carry a `children` of its own: an
    // unconditional `undefined` would overwrite it, and a spread has already made the literal
    // shapeless anyway.
    let rendered = false
    for (const child of content) {
        if (child.kind !== 'text' || child.value.trim() !== '') {
            rendered = true
            break
        }
    }
    if (rendered) props.push(`children: ${fragment(content, context)}`)
    else if (!spread) props.push('children: undefined')

    // A state- or memo-named tag is a REACTIVE component: the cell is read, so a change re-mounts it.
    const callee = liveCell(context, node.name) ? `${node.name}()` : node.name
    // CARRIED, not called — except for an inline component, which has no setup to protect. The call
    // used to happen wherever the enclosing thunk ran, and that thunk re-runs for anything the parent
    // reads: a keyed list gaining one row rebuilt every instance in it and discarded whatever the
    // user had typed into any of them. `component()` hands the view and its props to the position
    // instead, which holds the instance and writes the props into cells. See docs/COMPONENTS.md.
    if (context.inline.has(node.name)) return `${callee}({ ${props.join(', ')} })`
    return `${need(context, 'component')}(${callee}, { ${props.join(', ')} })`
}

function key(name: string): string {
    return IDENTIFIER.test(name) ? name : JSON.stringify(name)
}

/** Top level only: a `{#component}` written inside another one's children is a PROP, not a tag. */
function inlineComponents(template: Node[]): Set<string> {
    const names = new Set<string>()
    for (const node of template) {
        if (node.kind === 'define') names.add(node.name)
    }
    return names
}

function define(node: { name: string; parameters: string; body: Node[] }, context: Context): string {
    const inner: Context = {
        ...context,
        shadow: new Set(context.shadow),
        children: childrenOf(node.parameters),
    }
    for (const name of parameterNames(node.parameters)) inner.shadow.add(name)
    return `(${node.parameters || 'args'}) => ${fragment(node.body, inner)}`
}

/** Split on a character at the TOP level — outside every bracket, brace and string. */
function splitTop(text: string, on: string): string[] {
    const parts: string[] = []
    let depth = 0
    let quote = ''
    let from = 0
    for (let i = 0; i < text.length; i++) {
        const char = text[i] as string
        if (quote !== '') {
            if (char === '\\') i++
            else if (char === quote) quote = ''
        } else if (char === '"' || char === "'" || char === '`') quote = char
        else if (char === '(' || char === '[' || char === '{') depth++
        else if (char === ')' || char === ']' || char === '}') depth--
        else if (char === on && depth === 0) {
            parts.push(text.slice(from, i))
            from = i + 1
        }
    }
    parts.push(text.slice(from))
    return parts
}

/**
 * How a `<slot/>` inside this parameter list reaches the children — the name the parameter BOUND
 * them under, not the `args` an outer component happens to use.
 *
 * The pattern is read rather than scanned for the WORD: `{ children: kids }` binds `kids`, and
 * answering `children` there names either nothing or, worse, something else in scope — which is the
 * same silent reach-past this function exists to stop, one spelling over.
 */
function childrenOf(parameters: string): string | null {
    const trimmed = parameters.trim()
    if (trimmed === '') return 'args.children'
    // Apart from its type annotation and its default: `props: {…} = {}` binds `props`.
    const bound = (splitTop(trimmed, ':')[0] as string).trim()
    const named = (splitTop(bound, '=')[0] as string).trim()
    if (IDENTIFIER.test(named)) return `${named}.children`
    if (!named.startsWith('{') || !named.endsWith('}')) return null
    // A destructuring pattern reaches them only if it TOOK them, and only from its own top level —
    // a `children` nested inside another member is a different property entirely.
    for (const member of splitTop(named.slice(1, -1), ',')) {
        const renamed = splitTop(member, ':')
        if ((renamed[0] as string).trim() !== 'children') continue
        const target = renamed.length === 1 ? 'children' : (renamed[1] as string)
        const local = (splitTop(target, '=')[0] as string).trim()
        return IDENTIFIER.test(local) ? local : null
    }
    return null
}

// --- control flow ----------------------------------------------------------

/**
 * The thunk a `{#if}` becomes. An else-if chain is a sequence of early returns rather than nested
 * ternaries, so each condition's hoisted reads sit in scope for its own branch only — and a later
 * condition still does not run when an earlier one matched.
 */
function conditional(branches: Branch[], context: Context): string {
    // The chain, and nothing around it. A `{#if x.pending()}` head used to be matched here and
    // wrapped in `awaited(cell, { pending, then, catch })` — one arm handed over three times — so
    // that the SERVER knew to defer this region and the client's settle landed on the same template.
    //
    // The walk decides deferral now, off the probe rather than off the spelling, so the wrapper was
    // carrying only the second half. It was not carrying it: the no-op held only while both arms
    // reached a slot in the SAME shape, and a compiled chain's arms are different templates, so the
    // settle rebuilt the region either way. Measured on a gated load — inserted 2, removed 1,
    // created 1 element · 1 text · 1 comment, cloned 2, IDENTICAL with the wrapper and without it.
    return chained(branches, context)
}


/**
 * The cells an UNCONDITIONAL child slot reads, so setup can start their loads before the walk reaches
 * the first of them.
 *
 * A load begins on its first read, and in a server render that read is the walk ARRIVING at the slot.
 * So three sections holding three independent loads cost their SUM rather than their longest — three
 * 60ms loads rendered in 185ms, and in 63ms once they start together, with the same blocking and the
 * same complete markup. This collects the set the walk was going to read anyway; only the timing moves.
 *
 * UNCONDITIONAL is the whole of the rule, and it is why the descent stops at every block and every
 * component: a load inside a branch nobody takes is work the page never asked for, and a `{#for}`
 * row's reads belong to the row. A deferring block needs nothing from here — `awaited` already asks
 * its operand for the settle before the arm runs.
 *
 * A PLAIN READ only: a name, or a member path off one, with no call anywhere in it. That excludes
 * every probe under one condition rather than a list of them, and the exclusion is load-bearing —
 * `{x.pending() ? … : x}` decides what to show from whether the load has BEGUN, so starting it early
 * would turn a page that blocks into one showing a placeholder that never leaves. That spelling has
 * its own problems; they are not this change's to introduce.
 *
 * What lands in `into` is the memo the SLOT names; `rootsOf` turns each into the loads under it, so a
 * page of plain `state` emits nothing at all here and a page of aggregates emits its rpcs.
 */
function eagerCells(
    nodes: readonly Node[],
    memos: ReadonlyMap<string, readonly string[]>,
    into: Set<string>,
): void {
    for (const node of nodes) {
        if (node.kind === 'element') eagerCells(node.children, memos, into)
        else if (node.kind === 'expression' && !node.raw) {
            const source = node.value.source
            if (source.includes('(')) continue
            const name = LEADING_IDENTIFIER.exec(source)?.[0]
            if (name === undefined) continue
            // What follows the name must be a member PATH and nothing else, so `{a.b}` is in and
            // `{a + b}` is out — with no expression parser to run for the answer.
            if (!MEMBER_PATH.test(source.slice(name.length))) continue
            if (memos.has(name)) into.add(name)
        }
    }
}

const LEADING_IDENTIFIER = /^[A-Za-z_$][\w$]*/
const MEMBER_PATH = /^(\??\.[A-Za-z_$][\w$]*)*$/

/**
 * The memos named inside a `memo(…)`'s own argument list — what this one DERIVES from.
 *
 * Empty means a ROOT: a body that loads rather than one that reads another cell and reshapes it. Only
 * a root is worth starting, because starting a derivation runs its body as far as the read it derives
 * from, which signals, and the half-run body is discarded — a page fanning five aggregates out of one
 * rpc paid five aborted body entries and started nothing the first slot's read would not have.
 *
 * A KEYED source deliberately does not count. `memo(() => catalogue({ … }))` names an rpc and is the
 * very root this exists to start, so only a zero-arity memo already declared can appear here — which
 * is also why one pass in declaration order is enough to build the whole map.
 */
function memosReferenced(
    tokens: Token[],
    open: number,
    declared: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
    let found: string[] | null = null
    let depth = 0
    for (let i = open; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (token.kind === SyntaxKind.OpenParenToken) depth++
        else if (token.kind === SyntaxKind.CloseParenToken) {
            depth--
            if (depth === 0) break
        } else if (token.kind === SyntaxKind.Identifier && declared.has(token.text)) {
            if (found === null) found = [token.text]
            else if (!found.includes(token.text)) found.push(token.text)
        }
    }
    // One shared empty array for every root, which is most of them.
    return found ?? NO_REFERENCES
}

const NO_REFERENCES: readonly string[] = []

/**
 * The loads under a memo the template names, however many derivations sit between.
 *
 * A page reading only its aggregates never names the rpc they came from, so without this the roots
 * start when the walk arrives and cost their SUM: three independent roots behind two derivations each
 * rendered in 185ms, and in 62ms once resolved — the same 3x the flat case has, and with the same
 * derived body counts, because what gets started is the load rather than the derivation.
 *
 * `seen` is the cycle guard. A cycle cannot typecheck, but this walk runs before anything checks that.
 */
function rootsOf(
    name: string,
    memos: ReadonlyMap<string, readonly string[]>,
    seen: Set<string>,
    into: Set<string>,
): void {
    if (seen.has(name)) return
    seen.add(name)
    const from = memos.get(name)
    if (from === undefined) return
    if (from.length === 0) {
        into.add(name)
        return
    }
    for (const source of from) rootsOf(source, memos, seen, into)
}

function chained(branches: Branch[], context: Context): string {
    // The CONDITIONS alone decide the shape, so hoist them all before emitting a single body:
    // `fragment` recurses, so a body emitted for the losing shape would be compiled twice — and
    // exponentially with nesting.
    const arms: { branch: Branch; inner: Context; declarations: string[]; text: string }[] = []
    let hoists = false
    // The scope is CARRIED from one arm to the next, so `{#if mode === 'a'}{:else if mode === 'b'}`
    // reads `mode` once for the chain rather than once per arm. `hoistReads` skips a name already in
    // the scope it was handed, so a later arm reading something ELSE still declares it in its own
    // position — only the repeat collapses. Without this the arms each took their own local, and the
    // duplicate reads subscribed the slot's effect to the same cell N times: `sources` has no dedupe,
    // so every later re-run walked N entries and did N-1 `observers.delete` calls that miss.
    let carried = context
    for (const branch of branches) {
        if (branch.test === null) {
            arms.push({ branch, inner: carried, declarations: [], text: '' })
            break
        }
        const { declarations, scope, text } = hoistReads(branch.test, carried)
        if (declarations.length > 0) hoists = true
        carried = withHoists(context, scope)
        arms.push({ branch, inner: carried, declarations, text })
    }

    if (!hoists) {
        // Nothing to narrow, so keep the ternary — it is the shape a person would have written.
        let out = ''
        for (const arm of arms) {
            if (arm.branch.test === null) return `() => ${out}${fragment(arm.branch.body, context)}`
            // The text `hoistReads` already produced: nothing hoisted on this path, so the scope it
            // was emitted against is the one `code` would use.
            // Same operand rule as `switched`'s case values: `{#if a ?? b}` inlined bare emits
            // `a ?? b ? x : y`, which JavaScript reads as `a ?? (b ? x : y)`. The `if (…)` form
            // below is safe on its own, so only the ternary needs this.
            out += `${operand(arm.text)} ? ${fragment(arm.branch.body, context)} : `
        }
        return `() => ${out}null`
    }

    const parts: string[] = []
    for (const arm of arms) {
        if (arm.branch.test === null) {
            parts.push(`return ${fragment(arm.branch.body, arm.inner)}`)
            break
        }
        for (const declaration of arm.declarations) parts.push(declaration)
        parts.push(`if (${code(arm.branch.test, arm.inner)}) return ${fragment(arm.branch.body, arm.inner)}`)
    }
    const last = parts[parts.length - 1] as string
    if (!last.startsWith('return ')) parts.push('return null')
    return `() => { ${parts.join('; ')} }`
}

function switched(node: { value: Expr; branches: Branch[] }, context: Context): string {
    const { declarations, scope, text } = hoistReads(node.value, context)
    const inner = withHoists(context, scope)
    // Re-emitted only when the hoist CHANGED the scope; otherwise `hoistReads`'s own pass is it.
    const emitted = declarations.length === 0 ? text : code(node.value, inner)
    // Bound ONCE unless it is already atomic. The sugared `{#switch mode}` came back from
    // `hoistReads` as a local already, but the explicit `{#switch mode()}` — which SPEC guarantees
    // keeps working — came back as a call, and interpolating it per case read the cell once per arm
    // and subscribed the slot's effect that many times to it. A switch subject is evaluated once in
    // JS anyway, so this is also the more faithful emit. `ATOMIC` rather than `unthunked`: the
    // question here is whether the text can be pasted into N comparisons, not whether it can read.
    let subject = emitted
    if (!ATOMIC.test(emitted)) {
        subject = `$${context.counter.n++}`
        declarations.push(`const ${subject} = ${emitted}`)
    }

    let out = ''
    for (const branch of node.branches) {
        if (branch.test === null) {
            out += fragment(branch.body, inner)
            return declarations.length === 0
                ? `() => ${out}`
                : `() => { ${declarations.join('; ')}; return ${out} }`
        }
        // The case value goes in as an OPERAND: `{:case alt ? 'a' : 'b'}` pasted bare emits
        // `$0 === alt ? 'a' : 'b' ? … : …`, which is a different expression entirely.
        out += `${subject} === ${operand(code(branch.test, inner))} ? ${fragment(branch.body, inner)} : `
    }
    return declarations.length === 0
        ? `() => ${out}null`
        : `() => { ${declarations.join('; ')}; return ${out}null }`
}

function loop(
    node: {
        item: string
        index: string | null
        list: Expr
        key: Expr | null
        streaming: boolean
        body: Node[]
        failure: Branch | null
    },
    context: Context,
): string {
    const inner: Context = { ...context, shadow: new Set(context.shadow) }
    for (const name of parameterNames(node.item)) inner.shadow.add(name)
    if (node.index !== null) inner.shadow.add(node.index)

    const parameters = node.index === null ? node.item : `${node.item}, ${node.index}`

    // The row is already a closure, so a branch-local `<script>` — SPEC's per-ITEM case, and the one
    // it names — goes straight into its body rather than paying for an IIFE the way `fragment` must.
    const branch = scoped(node.body, inner)
    const markup = fragment(branch.rest, branch.context)
    // A key makes a reorder MOVE its row instead of rewriting it; without one the list is positional.
    //
    // `fragment` answers `null` for an empty body, which is right for a BRANCH arm — nothing to paint
    // is nothing — and wrong for a keyed row: `keyed` takes a template by signature, and the reconcile
    // reads `.template` off the row without probing, because that is the arm walked per row. So an
    // empty keyed body rendered `<ul></ul>` on the server and threw in the browser. Fixed at the one
    // caller that can produce it rather than by making every keyed row pay a probe.
    const rowMarkup = markup === 'null' && node.key !== null ? `${need(context, 'html')}\`\`` : markup
    const keyedRow =
        node.key === null
            ? rowMarkup
            : `${need(context, 'keyed')}(${code(node.key, branch.context)}, ${rowMarkup})`
    const row =
        branch.statements === ''
            ? `(${parameters}) => ${keyedRow}`
            : `(${parameters}) => {${branch.statements}return ${keyedRow} }`

    if (!node.streaming) return `(${code(node.list, context)} ?? []).map(${row})`

    const failure =
        node.failure === null
            ? ''
            : `, (${node.failure.binding ?? '_error'}) => ${fragment(node.failure.body, inner)}`
    const source = code(node.list, context, 'slot')
    return `${need(context, 'streamed')}(${source}, ${row}${failure})`
}

function guarded(node: { body: Node[]; branches: Branch[] }, context: Context): string {
    const failure = node.branches.find((b) => b.test?.source === 'catch')
    const settled = node.branches.find((b) => b.test?.source === 'finally')
    const inner: Context =
        failure?.binding == null
            ? context
            : { ...context, shadow: new Set([...context.shadow, failure.binding]) }

    // All four keys, `undefined` included: `Branches` declares four, and an arm omitted here is a
    // different hidden class reaching the same reads in `settledArms` and `ChildPart`. Sixteen arm
    // combinations across a page is what turns those shared reads megamorphic, and a block inside a
    // `{#for}` pays it per row. The same four a deferring `{#if}` writes, for the same reason.
    const arms = [
        `pending: undefined`,
        `then: undefined`,
        `catch: ${failure === undefined ? 'undefined' : `(${failure.binding ?? '_error'}) => ${fragment(failure.body, inner)}`}`,
        `finally: ${settled === undefined ? 'undefined' : `() => ${fragment(settled.body, context)}`}`,
    ]

    // The body is emitted EAGERLY — see `Context.eager`. One unit, so a throw anywhere in it reaches
    // the boundary rather than the nested effect that would otherwise have owned the expression.
    const body = fragment(node.body, { ...context, eager: true })
    return `${need(context, 'boundary')}(() => ${body}, { ${arms.join(', ')} })`
}

// --- the file --------------------------------------------------------------

export function emit(
    source: string,
    blocks: Blocks,
    options: EmitOptions,
): { code: string; segments: Segment[] } {
    const name = componentName(options.filename)

    // Each region through the scanner ONCE, here, and the tokens handed to everything that asks
    // something of it — the export check, the import split and the reactive walk were three passes
    // over the same span.
    const moduleBody = blocks.module === null ? '' : blocks.module.body
    const moduleTo = blocks.module === null ? 0 : blocks.module.start + moduleBody.length
    const moduleTokens =
        blocks.module === null ? NO_TOKENS : tokensOf(source, blocks.module.start, moduleTo)
    const moduleImports =
        blocks.module === null
            ? { imports: [], rest: '' }
            : splitImports(source, blocks.module.start, moduleTo, moduleTokens)

    checkNoProps(source, moduleTokens, options.filename)

    let setup: { imports: string[]; rest: string } = { imports: [], rest: '' }
    let setupRegion: Token[] = NO_TOKENS
    if (blocks.setup !== null) {
        const from = blocks.setup.start
        const to = from + blocks.setup.body.length
        setupRegion = tokensOf(source, from, to)
        checkNoExport(setupRegion, options.filename)
        setup = splitImports(source, from, to, setupRegion)
    }

    // The props call is read off the import-lifted body, which is the text that becomes the function:
    // an import cannot hold a call, and the offsets have to line up with the splice below.
    const setupTokens = tokensOfBody(setup.rest)
    // One reader per token ARRAY: its constructor walks every token to collect the file's own type
    // declarations, and `propsCall` and `declaredTypes` were each building their own over the same
    // one. Same array, same answer.
    const setupTypes = new TypeReader(setupTokens)
    const declared = propsCall(setup.rest, setupTokens, setupTypes)
    if (declared !== null) {
        checkPropsImported(setup.imports, blocks.setup?.start ?? 0, options.filename)
    }
    // `props<T>()` IS the parameter — the call is erased and the type argument becomes its annotation —
    // and every prop local is bound to the cell the position holds for it.
    const kinds =
        declared === null
            ? NO_KINDS
            : propKinds(
                  declared.bound,
                  declared.type === null
                      ? ''
                      : membersOf(declared.type, setup.rest, setupTokens, setupTypes) ||
                        importedMembers(declared.type, setup.imports, options.filename, options.resolve),
              )
    const replaced = declared === null ? setup.rest : bindProps(setup.rest, declared, kinds)
    // No `props()` is the common shape — most `.abide` files are a page, and a page takes none. The
    // splice never happened, so the text is the text `setupTokens` was scanned from and re-lexing it
    // is a full TypeScript scanner pass per compile for a string that did not change.
    const replacedTokens = declared === null ? setupTokens : tokensOfBody(replaced)
    const replacedTypes = declared === null ? setupTypes : new TypeReader(replacedTokens)

    const reactive: Reactive = { cells: new Set(), keyed: new Set() }
    // Every zero-arity memo, mapped to the memos it derives FROM. `memo` alone, and the other two
    // constructors are not an omission: a `state(promise)` is already running before the cell exists —
    // the promise was constructed by the argument expression — and a `channel` never loads at all. A
    // memo is the one source holding a body that has not run.
    const memos = new Map<string, readonly string[]>()
    reactiveBindings(moduleTokens, reactive, memos)
    reactiveBindings(setupRegion, reactive, memos)
    // The imports were lifted out of both regions above, so the bindings walk never sees them.
    rpcImports(moduleImports.imports, reactive)
    rpcImports(setup.imports, reactive)
    for (const [local, kind] of kinds) {
        if (kind === 'cell') reactive.cells.add(local)
        else if (kind === 'keyed') reactive.keyed.add(local)
    }

    const context: Context = {
        source,
        filename: options.filename,
        reactive,
        scope: null,
        sheets: new Map(),
        lifted: new Map(),
        eager: false,
        shadow: new Set(),
        hoisted: new Map(),
        children: 'args.children',
        inline: inlineComponents(blocks.template),
        used: new Set(),
        counter: { n: 0 },
    }
    // `bindProps` already wrote the calls into the setup body; the header only has to import them.
    for (const kind of kinds.values()) {
        if (kind === 'cell') {
            need(context, 'propCell')
            break
        }
    }

    // A top-level `<style>` block scopes the COMPONENT: every element it emits carries the attribute,
    // every selector in it requires that attribute on its rightmost compound, and the rules are
    // registered once at MODULE scope — so by the time anything renders, every imported component has
    // declared its CSS and the server can put the whole sheet in `<head>` without tracking what a
    // render reached. A nested block is the same machine over a subtree, and registers itself during
    // the walk below; this one goes first so the component's own rules sit above them in the cascade.
    if (blocks.styles.length > 0) {
        let css = ''
        for (const block of blocks.styles) css += block.body
        context.scope = registerSheet(css, context)
    }

    // Inline components are hoisted into the setup body so they can be passed as values. The NAMES
    // were taken first, above: an inline component's own body may invoke a sibling.
    let defines = ''
    for (const node of blocks.template) {
        if (node.kind === 'define') defines += `    const ${node.name} = ${define(node, context)}\n`
    }

    // The lifted `<script>`/`<style>` blocks were blanked rather than removed, so file offsets stay
    // true for diagnostics; what they leave behind is leading and trailing whitespace in the markup,
    // which would otherwise become real text nodes.
    const markup = children(blocks.template, context).replace(/^\s+/, '\n').replace(/\s+$/, '\n')
    const lifted = liftTypes(replaced, declaredTypes(replacedTokens, replacedTypes))
    const args = `args: ${signature(declared)}`

    // Read off the template rather than the walk's leavings, and BEFORE the header below, which is
    // built from what the file turned out to need.
    const named = new Set<string>()
    eagerCells(blocks.template, memos, named)
    const eager = new Set<string>()
    const seen = new Set<string>()
    for (const name of named) rootsOf(name, memos, seen, eager)
    const started = eager.size === 0 ? '' : `    ${need(context, 'start')}([${[...eager].join(', ')}])\n`

    // `html` and the return type are always needed; everything else is imported only if the file
    // turned out to use it, so a component that never toggles a class does not import `classes`.
    context.used.add('html')
    // Two statements, because the two specifiers mean different things: `abide` is what an author
    // types, and `abide/runtime` is what only this emitter does. The split falls where
    // `AUTHORED_RUNTIME` does — `html` is the one name a source file also spells, so it stays on
    // `abide` and merges with the author's own import of it. Nothing on `abide/runtime` can collide,
    // because nothing there is a name a source file spells.
    const authored: string[] = []
    const emitted: string[] = []
    for (const name of [...context.used].sort()) (AUTHORED_RUNTIME.has(name) ? authored : emitted).push(name)
    // Two ENTRIES, not one string with a newline in it: `mergeImports` parses one statement per
    // element, and a two-line element matches nothing and falls through unmerged.
    // `Props` only when there is a props call to map — a component that takes none never names it,
    // and an unused type import is what `lint` reports.
    const types = declared === null ? 'type TemplateResult' : `type Props as ${PROPS_TYPE}, type TemplateResult`
    const header = [`import { ${authored.join(', ')}, ${types} } from 'abide'`]
    if (emitted.length > 0) header.push(`import { ${emitted.join(', ')} } from 'abide/runtime'`)

    // Joined only now: `children` above is what discovers a nested block, so the registry is not
    // complete until the walk is done.
    let adopted = ''
    for (const statement of context.sheets.values()) adopted += statement
    // The same reasoning, for the static arrays a `class:`/`style:` toggle lifted out of its thunk.
    for (const [literal, name] of context.lifted) adopted += `const ${name} = ${literal}\n`

    const setupBody = indent(desugarBody(lifted.body, reactive))
    const assembled =
        mergeImports([...header, ...moduleImports.imports, ...setup.imports], ERASED_IMPORTS) +
        `${desugarBody(moduleImports.rest, reactive)}\n${adopted}` +
        (lifted.declarations === '' ? '' : `${lifted.declarations}\n`) +
        `export default function ${name}(${args}): TemplateResult {\n` +
        `${setupBody}${started}${defines}` +
        `    return html\`${markup}\`\n` +
        `}\n`

    // One pass over the finished string lifts every marker back out, which is why nothing upstream
    // had to carry a generated position around.
    return extract(assembled, source)
}

/** A type declared at the top level of a setup body: its name, and where it starts and ends. */
interface Declared {
    name: string
    start: number
    end: number
}

/**
 * Every top-level `type X = …` and `interface X { … }` in a setup body.
 *
 * Where a type ENDS is asked of the same reader the desugar asks, because there is one grammar for it:
 * a character scan that stopped at the first newline outside a bracket cut a wrapped union in half —
 * `type Props =` on its own line lifted the `=` and left the alternatives behind in the body, which is
 * not parseable in either lane. Brackets alone cannot answer it, and neither can a regex.
 */
function declaredTypes(tokens: Token[], types: TypeReader): Declared[] {
    const found: Declared[] = []
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] as Token
        // Top-level only: a type inside a block is somebody else's local.
        if (token.depth !== 0) continue
        const name = tokens[i + 1]
        if (name === undefined || !IDENTIFIER.test(name.text)) continue

        if (token.text === 'type' && tokens[i + 2]?.kind === SyntaxKind.EqualsToken) {
            const end = tokens[types.extent(i + 3) - 1]?.end
            if (end === undefined) continue
            found.push({ name: name.text, start: token.start, end })
            continue
        }
        if (token.kind !== SyntaxKind.InterfaceKeyword) continue
        // An interface body is a brace block, and the lexer already counted the depth of every one.
        for (let at = i + 2; at < tokens.length; at++) {
            const inside = tokens[at] as Token
            if (inside.kind !== SyntaxKind.CloseBraceToken || inside.depth !== 0) continue
            found.push({ name: name.text, start: token.start, end: inside.end })
            break
        }
    }
    return found
}

/**
 * The declarations taken OUT of the setup body, so the signature can name one.
 *
 * The signature that uses the props type is written outside the body it was declared in: inlined, the
 * name is out of scope in the one place it is needed and every component that declared one fails to
 * compile with `Cannot find name`. All of them move rather than the one that is named, because a type
 * alias has no runtime and no per-instance meaning — module scope is where they always belonged, and
 * a rule that lifted only the type the signature happens to reference would strand the ones it is
 * written in terms of.
 */
function liftTypes(rest: string, found: Declared[]): { declarations: string; body: string } {
    let declarations = ''
    let body = ''
    let at = 0
    for (const type of found) {
        declarations += `${rest.slice(type.start, type.end)}\n`
        body += rest.slice(at, type.start)
        at = type.end
    }
    return { declarations, body: body + rest.slice(at) }
}

/**
 * A `<script>` body is desugared too — a write is a statement, so `count = 1` has to work in the
 * same places a person would write it. `expression: false` because a leading `{` there opens a
 * BLOCK, not an object literal, and `once` because these statements are the setup: a read among them
 * peeks, and gets the honest possibly-undefined type for it.
 */
function desugarBody(rest: string, reactive: Reactive): string {
    if (rest.trim() === '') return rest
    // The import-lifted text no longer lines up with the file, so it is desugared as its own region.
    return desugar(rest, 0, rest.length, reactive.cells, {
        expression: false,
        keyed: reactive.keyed,
        once: true,
    }).text
}

/**
 * Re-indent a `<script>` body into the component function, keeping its RELATIVE shape: a statement
 * broken over several lines has to stay readable, since this output is what a stack trace points at.
 */
function indent(body: string): string {
    const lines = body.split('\n')
    let common = Number.MAX_SAFE_INTEGER
    for (const line of lines) {
        if (line.trim() === '') continue
        common = Math.min(common, line.length - line.trimStart().length)
    }
    if (common === Number.MAX_SAFE_INTEGER) common = 0
    let out = ''
    for (const line of lines) {
        if (line.trim() === '') continue
        out += `    ${line.slice(common).trimEnd()}\n`
    }
    return out
}

function componentName(filename: string): string {
    const base = (filename.split('/').pop() ?? 'Component').replace(/\.abide$/, '')
    const cleaned = base.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) =>
        c === undefined ? '' : c.toUpperCase(),
    )
    const titled = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
    return /^[A-Za-z]/.test(titled) ? titled : `Component${titled}`
}
