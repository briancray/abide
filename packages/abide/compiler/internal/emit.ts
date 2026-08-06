// The node tree becomes the file a careful author would have written by hand.
//
// Not a pre-scanned `TemplateResult`: an `html` tagged template, the shape `packages/example/app.ts`
// already is. `slotsOf` and `prepare` are keyed on the `strings` identity a tagged template gives
// for free, so the scan and the parse happen once per call site whatever the compiler does — and
// what pre-scanning would buy is one scan per call site per process, against a stack trace that no
// longer points at anything a person wrote.
//
// The one invariant every emit rule serves: EVERY expression gets its own thunk, and evaluating an
// `html` tag does not call the thunks inside it. So the thunk around a `{#if}` subscribes to the
// condition and nothing else, and a `{count}` deep inside the branch still wakes alone. Wrapping a
// whole branch body in one thunk would produce identical output at a much coarser wake.

import { SyntaxKind } from 'typescript/unstable/ast'
import { scopeCss, scopeName } from './css.ts'
import { desugar, REACTIVE_CONSTRUCTORS, REACTIVE_TYPES } from './desugar.ts'
import { Lexer, type Token } from './lex.ts'
import { extract, mark, type Segment } from './map.ts'
import type { Attribute, Blocks, Branch, Expr, Node } from './parse.ts'
import { ParseError } from './parse.ts'
import { VOID_ELEMENTS } from './VOID_ELEMENTS.ts'

export interface EmitOptions {
    /** Used for the default export's name and for error messages. */
    filename: string
}

interface Context {
    source: string
    /** `data-a<hash>` for the component's `<style>` block, written onto every element it emits. */
    scope: string | null
    reactive: Reactive
    /** Names bound by a `{#for}` or a branch, which shadow a reactive name of the same spelling. */
    shadow: Set<string>
    /** Reads a `{#if}` or `{#switch}` already took into a local, so the body narrows off it. */
    hoisted: Map<string, string>
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

// Every name here must be an export of `abide`, because that is the import the header writes. A
// component invocation is NOT in this union: `<Thing/>` emits a direct call of the imported
// function, so there is no runtime helper behind it to import.
type Runtime = 'html' | 'raw' | 'keyed' | 'classes' | 'styles' | 'awaited' | 'boundary' | 'streamed' | 'adopt'

/** A keyword that is a deliberate error in a region, reported at the token that spelled it. */
function forbidKeyword(source: string, from: number, to: number, kind: SyntaxKind, message: string): void {
    const lexer = new Lexer(source, from)
    for (;;) {
        const token = lexer.next()
        if (token === null || token.start >= to) return
        if (token.kind === kind) throw new ParseError(message, token.start)
    }
}

/** Statement-position `export` inside a `<script>`, which CLAUDE.md makes a deliberate error. */
function checkNoExport(source: string, from: number, to: number, filename: string): void {
    forbidKeyword(
        source,
        from,
        to,
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

function reactiveBindings(source: string, from: number, to: number, into: Reactive): void {
    const lexer = new Lexer(source, from)
    const tokens: Token[] = []
    for (;;) {
        const token = lexer.next()
        if (token === null || token.start >= to) break
        tokens.push(token)
    }

    for (let i = 1; i < tokens.length; i++) {
        // `NAME = state(` — or `NAME = state<T>(`, whose type argument list sits between the two.
        if ((tokens[i] as Token).kind !== SyntaxKind.OpenParenToken) continue
        const callee = calleeBefore(tokens, i)
        if (callee < 1) continue
        const call = tokens[callee] as Token
        if (!REACTIVE_CONSTRUCTORS.has(call.text)) continue
        if (tokens[callee - 1]?.kind !== SyntaxKind.EqualsToken) continue
        const name = tokens[callee - 2]
        if (name === undefined || name.kind !== SyntaxKind.Identifier) continue

        if (call.text !== 'memo') {
            into.cells.add(name.text)
            continue
        }
        // Past an `async`, the body's own parameter list decides the form.
        let at = i + 1
        if (tokens[at]?.kind === SyntaxKind.AsyncKeyword) at++
        if (tokens[at]?.kind !== SyntaxKind.OpenParenToken) {
            // `memo(fn)` — a reference, whose shape is not visible here. Read by name, as before.
            into.cells.add(name.text)
            continue
        }
        if (tokens[at + 1]?.kind === SyntaxKind.CloseParenToken) into.cells.add(name.text)
        else into.keyed.add(name.text)
    }
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
 * Props that ARE cells, read off the declared `Args` type. Syntactic: the annotation sits in the
 * same `<script>`, so no checker is needed to see `count: State<number>`.
 */
function reactiveProps(script: string, into: Reactive): void {
    const declaration = /\btype\s+Args\s*=\s*\{([\s\S]*?)\n?\}/.exec(script)
    if (declaration === null) return
    const body = declaration[1] as string
    const member = /([A-Za-z_$][\w$]*)\s*\??\s*:\s*([A-Za-z_$][\w$]*)\s*</g
    for (;;) {
        const match = member.exec(body)
        if (match === null) return
        const type = match[2] as string
        if (type === 'KeyedMemo') into.keyed.add(match[1] as string)
        else if (REACTIVE_TYPES.has(type)) into.cells.add(match[1] as string)
    }
}

interface Import {
    default: string | null
    namespace: string | null
    named: string[]
    bare: boolean
}

const IMPORT_FORM = /^import\s+(?:(type)\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]/

/**
 * One import per module, however many blocks asked for it.
 *
 * A `<script module>` and a `<script>` may both `import { memo } from 'abide'`, and the compiler adds
 * its own `abide` import on top. Concatenating them redeclares the binding, which is a SyntaxError —
 * so the specifiers are merged rather than the statements stacked.
 */
function mergeImports(statements: string[]): string {
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
            entry = { default: null, namespace: null, named: [], bare: false }
            byModule.set(module, entry)
            order.push(module)
        }
        if (match[4] !== undefined) {
            entry.bare = true
            continue
        }
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
function splitImports(source: string, from: number, to: number): { imports: string[]; rest: string } {
    const lexer = new Lexer(source, from)
    const spans: { start: number; end: number }[] = []
    let pending: number | null = null
    let sawFrom = false
    for (;;) {
        const token = lexer.next()
        if (token === null || token.start >= to) break
        if (pending === null) {
            // `import(` is a dynamic import — an expression, which stays where it is.
            if (token.kind === SyntaxKind.ImportKeyword) {
                pending = token.start
                sawFrom = false
            }
            continue
        }
        if (token.kind === SyntaxKind.OpenParenToken && token.start === pending + 6) {
            pending = null
            continue
        }
        if (token.kind === SyntaxKind.FromKeyword) sawFrom = true
        else if (token.kind === SyntaxKind.StringLiteral && (sawFrom || token.start === pending + 7)) {
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

function live(context: Context): Reactive {
    if (context.shadow.size === 0) return context.reactive
    const cells = new Set<string>()
    for (const name of context.reactive.cells) if (!context.shadow.has(name)) cells.add(name)
    const keyed = new Set<string>()
    for (const name of context.reactive.keyed) if (!context.shadow.has(name)) keyed.add(name)
    return { cells, keyed }
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

const NO_HOIST: ReadonlyMap<string, string> = new Map()

function code(expr: Expr, context: Context, position: Position = 'read'): string {
    const names = live(context)
    const hoisted = position === 'cell' ? NO_HOIST : context.hoisted
    if (/^[A-Za-z_$][\w$]*$/.test(expr.source) && names.cells.has(expr.source)) {
        const local = hoisted.get(expr.source)
        if (local !== undefined) return local
        return position === 'read' ? `${expr.source}()` : expr.source
    }
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
function hoistReads(expr: Expr, context: Context): { declarations: string[]; scope: Map<string, string> } {
    const names = live(context)
    const found = desugar(context.source, expr.start, expr.start + expr.source.length, names.cells, {
        keyed: names.keyed,
        hoisted: context.hoisted,
    }).reads

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
    return { declarations, scope }
}

function withHoists(context: Context, scope: Map<string, string>): Context {
    return { ...context, hoisted: scope }
}

/** A child slot: the enclosing condition's hoisted value if there is one, else the cell. */
function slotted(expr: Expr, context: Context): string {
    return code(expr, context, 'slot')
}

/** The positions that need the cell itself: `bind:`, `&ref`, a component prop. */
function held(expr: Expr, context: Context): string {
    return code(expr, context, 'cell')
}

/** Record a runtime helper the emitted file turned out to need, so the header imports it. */
function need(context: Context, name: Runtime): Runtime {
    context.used.add(name)
    return name
}

/** Static markup text, escaped for the template literal it is being pasted into. */
function literal(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

// --- children --------------------------------------------------------------

function children(nodes: Node[], context: Context): string {
    let out = ''
    for (const node of nodes) out += child(node, context)
    return out
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

/** The same, for a producer that is already a thunk. */
function called(thunk: string, context: Context): string {
    return context.eager ? `\${(${thunk})()}` : `\${${thunk}}`
}

function child(node: Node, context: Context): string {
    switch (node.kind) {
        case 'text':
            return literal(node.value)
        case 'expression': {
            const text = slotted(node.value, context)
            // `{html(...)}` is SPEC's raw escape hatch; the runtime spells it `raw(...)`.
            const value = node.raw
                ? `${need(context, 'raw')}(${text.replace(/^html\s*\(/, '').replace(/\)$/, '')})`
                : text
            // Inside a `{#try}` the boundary is one unit, so nothing gets its own thunk.
            return slot(mark(node.value.start, value), context)
        }
        case 'element':
            return element(node, context)
        case 'component':
            return slot(invoke(node, context), context)
        case 'slot':
            return slot('args.children', context)
        case 'script':
            return ''
        // `conditional` and `switched` hand back a whole thunk, since an else-if chain needs a body
        // rather than an expression.
        case 'if':
            return called(conditional(node.branches, context), context)
        case 'switch':
            return called(switched(node, context), context)
        case 'for':
            return slot(loop(node, context), context)
        case 'await':
            return slot(awaited(node, context), context)
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
        // above it far more often than not.
        if (node.kind === 'text' && node.value.replace(/<!--[\s\S]*?-->/g, '').trim() === '') continue
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
    forbidKeyword(
        context.source,
        from,
        to,
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
    reactiveBindings(context.source, from, to, own)

    const reactive: Reactive = {
        cells: new Set(context.reactive.cells),
        keyed: new Set(context.reactive.keyed),
    }
    const shadow = new Set(context.shadow)
    for (const name of declaredNames(context.source, from, to)) {
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
function declaredNames(source: string, from: number, to: number): string[] {
    const names: string[] = []
    const lexer = new Lexer(source, from)
    let expecting = false
    for (;;) {
        const token = lexer.next()
        if (token === null || token.start >= to) return names
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
            case 'expression':
                open += ` ${attribute.name}=\${() => ${mark(attribute.value.start, code(attribute.value, context))}}`
                break
            case 'interpolated':
                open += ` ${attribute.name}=\${() => \`${interpolate(attribute.parts, context)}\`}`
                break
            case 'event':
                open += ` @${attribute.name}=\${${mark(attribute.value.start, code(attribute.value, context))}}`
                break
            case 'spread':
                open += ` ...=\${() => ${code(attribute.value, context)}}`
                break
            case 'bind':
                open += bind(attribute, node.name, staticValue, context)
                break
            case 'class':
            case 'style':
                break
        }
    }

    if (classToggles.length > 0) {
        const pairs = classToggles
            .map((a) => `[${code(a.value, context)}, ${JSON.stringify(a.name)}]`)
            .join(', ')
        open += ` class=\${() => ${need(context, 'classes')}(${JSON.stringify(staticClass)}, ${pairs})}`
    }
    if (styleToggles.length > 0) {
        const pairs = styleToggles
            .map((a) => `[${JSON.stringify(a.name)}, ${code(a.value, context)}]`)
            .join(', ')
        open += ` style=\${() => ${need(context, 'styles')}(${JSON.stringify(staticStyle)}, ${pairs})}`
    }

    if (node.children.length === 0 && VOID_ELEMENTS.has(node.name.toLowerCase())) return `${open} />`
    return `${open}>${children(node.children, context)}</${node.name}>`
}

const ELEMENT_TYPES: Record<string, string> = {
    input: 'HTMLInputElement',
    select: 'HTMLSelectElement',
    textarea: 'HTMLTextAreaElement',
}

function interpolate(parts: (string | Expr)[], context: Context): string {
    let out = ''
    for (const part of parts) {
        out += typeof part === 'string' ? literal(part) : `\${${code(part, context)}}`
    }
    return out
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
            : /^[A-Za-z_$][\w$]*$/.test(attribute.value.source)
              ? attribute.value.source
              : held(attribute.value, context)

    // The node itself, not a value — nothing to serialise, so SSR emits nothing for it.
    if (key_ === 'element') return ` &ref=\${${source}}`

    // The emitted listener is type-checked like any other code, so its parameter carries the type
    // the element actually has — an untyped `event` here is an implicit `any` in the author's build.
    const dom = ELEMENT_TYPES[tag] ?? 'HTMLElement'
    const target = (property: string): string => `(event.currentTarget as ${dom}).${property}`

    // `{get, set}` — an explicit accessor pair rather than a cell.
    const accessor = source.startsWith('{')
    const read = accessor ? `(${source}).get()` : `${source}()`
    const write = (value: string): string =>
        accessor ? `(${source}).set(${value})` : `${source}.set(${value})`

    if (key_ === 'checked' || key_ === 'selected') {
        // A boolean DOM property mirrored as a boolean ATTRIBUTE: present iff truthy, never
        // stringified — which is why the attribute slot is handed the raw boolean.
        return (
            ` .${key_}=\${() => !!${read}}` +
            ` ${key_}=\${() => !!${read}}` +
            ` @change=\${(event: Event) => ${write(target(key_))}}`
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
        const next =
            `Array.isArray(${read})` +
            ` ? (${target('checked')} ? [...${read}, ${mine}] : ${read}.filter((v: unknown) => v !== ${mine}))` +
            ` : ${mine}`
        return (
            ` .checked=\${() => Array.isArray(${read}) ? ${read}.includes(${mine}) : ${read} === ${mine}}` +
            ` @change=\${(event: Event) => ${write(next)}}`
        )
    }

    const listener = tag === 'select' ? 'change' : 'input'
    return ` .${key_}=\${() => ${read}}` + ` @${listener}=\${(event: Event) => ${write(target(key_))}}`
}

// --- components ------------------------------------------------------------

function invoke(node: { name: string; attributes: Attribute[]; children: Node[] }, context: Context): string {
    const props: string[] = []
    for (const attribute of node.attributes) {
        switch (attribute.kind) {
            case 'static':
                props.push(`${key(attribute.name)}: ${JSON.stringify(attribute.value)}`)
                break
            case 'expression':
                props.push(`${key(attribute.name)}: ${held(attribute.value, context)}`)
                break
            case 'interpolated':
                props.push(`${key(attribute.name)}: \`${interpolate(attribute.parts, context)}\``)
                break
            case 'event':
                // No element to attach to, so it is an ordinary prop the component places itself.
                props.push(`on${attribute.name}: ${held(attribute.value, context)}`)
                break
            case 'spread':
                props.push(`...${held(attribute.value, context)}`)
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
    const rendered = content.filter((n) => n.kind !== 'text' || n.value.trim() !== '')
    if (rendered.length > 0) props.push(`children: ${fragment(content, context)}`)

    // A state- or memo-named tag is a REACTIVE component: the cell is read, so a change re-mounts it.
    const callee = live(context).cells.has(node.name) ? `${node.name}()` : node.name
    return `${callee}({ ${props.join(', ')} })`
}

function key(name: string): string {
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
}

function define(node: { name: string; parameters: string; body: Node[] }, context: Context): string {
    const inner: Context = { ...context, shadow: new Set(context.shadow) }
    for (const name of bindingsOf(node.parameters)) inner.shadow.add(name)
    return `(${node.parameters || 'args'}) => ${fragment(node.body, inner)}`
}

/** Identifiers a parameter list binds — enough to shadow a reactive name of the same spelling. */
function bindingsOf(parameters: string): string[] {
    const names: string[] = []
    const pattern = /([A-Za-z_$][\w$]*)/g
    for (;;) {
        const match = pattern.exec(parameters)
        if (match === null) return names
        names.push(match[1] as string)
    }
}

// --- control flow ----------------------------------------------------------

/**
 * The thunk a `{#if}` becomes. An else-if chain is a sequence of early returns rather than nested
 * ternaries, so each condition's hoisted reads sit in scope for its own branch only — and a later
 * condition still does not run when an earlier one matched.
 */
function conditional(branches: Branch[], context: Context): string {
    // The CONDITIONS alone decide the shape, so hoist them all before emitting a single body:
    // `fragment` recurses, so a body emitted for the losing shape would be compiled twice — and
    // exponentially with nesting.
    const arms: { branch: Branch; inner: Context; declarations: string[] }[] = []
    let hoists = false
    for (const branch of branches) {
        if (branch.test === null) {
            arms.push({ branch, inner: context, declarations: [] })
            break
        }
        const { declarations, scope } = hoistReads(branch.test, context)
        if (declarations.length > 0) hoists = true
        arms.push({ branch, inner: withHoists(context, scope), declarations })
    }

    if (!hoists) {
        // Nothing to narrow, so keep the ternary — it is the shape a person would have written.
        let out = ''
        for (const arm of arms) {
            if (arm.branch.test === null) return `() => ${out}${fragment(arm.branch.body, context)}`
            out += `${code(arm.branch.test, context)} ? ${fragment(arm.branch.body, context)} : `
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
    const { declarations, scope } = hoistReads(node.value, context)
    const inner = withHoists(context, scope)
    const subject = code(node.value, inner)

    let out = ''
    for (const branch of node.branches) {
        if (branch.test === null) {
            out += fragment(branch.body, inner)
            return declarations.length === 0
                ? `() => ${out}`
                : `() => { ${declarations.join('; ')}; return ${out} }`
        }
        out += `${subject} === ${code(branch.test, inner)} ? ${fragment(branch.body, inner)} : `
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
    for (const name of bindingsOf(node.item)) inner.shadow.add(name)
    if (node.index !== null) inner.shadow.add(node.index)

    const parameters = node.index === null ? node.item : `${node.item}, ${node.index}`

    // The row is already a closure, so a branch-local `<script>` — SPEC's per-ITEM case, and the one
    // it names — goes straight into its body rather than paying for an IIFE the way `fragment` must.
    const branch = scoped(node.body, inner)
    const markup = fragment(branch.rest, branch.context)
    // A key makes a reorder MOVE its row instead of rewriting it; without one the list is positional.
    const keyedRow =
        node.key === null ? markup : `${need(context, 'keyed')}(${code(node.key, branch.context)}, ${markup})`
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

function awaited(node: { value: Expr; pending: Node[]; branches: Branch[] }, context: Context): string {
    const found = (keyword: string): Branch | undefined =>
        node.branches.find((b) => b.test?.source === keyword)
    const then = found('then')
    const failure = found('catch')
    const settled = found('finally')

    const inner = (branch: Branch | undefined): Context => {
        if (branch?.binding === undefined || branch.binding === null) return context
        const scoped: Context = { ...context, shadow: new Set(context.shadow) }
        scoped.shadow.add(branch.binding)
        return scoped
    }

    // Every branch is emitted as a CLOSURE, unevaluated. That is what splits the two effects: this
    // thunk evaluates only the operand, so the effect around it subscribes to what the operand reads
    // and to nothing else, and the part paints the branches later without ever waking it. Choosing a
    // branch here instead — by reading `pending()` — would make settling wake the thunk, which would
    // re-evaluate the operand into a fresh promise, which would settle, forever.
    const arms: string[] = []
    if (node.pending.length > 0) arms.push(`pending: () => ${fragment(node.pending, context)}`)
    if (then !== undefined) {
        arms.push(`then: (${then.binding ?? '_value'}) => ${fragment(then.body, inner(then))}`)
    }
    if (failure !== undefined) {
        arms.push(`catch: (${failure.binding ?? '_error'}) => ${fragment(failure.body, inner(failure))}`)
    }
    if (settled !== undefined) arms.push(`finally: () => ${fragment(settled.body, context)}`)

    const operand = code(node.value, context, 'slot')
    return `${need(context, 'awaited')}(${operand}, { ${arms.join(', ')} })`
}

function guarded(node: { body: Node[]; branches: Branch[] }, context: Context): string {
    const failure = node.branches.find((b) => b.test?.source === 'catch')
    const settled = node.branches.find((b) => b.test?.source === 'finally')
    const inner: Context =
        failure?.binding == null
            ? context
            : { ...context, shadow: new Set([...context.shadow, failure.binding]) }

    const arms: string[] = []
    if (failure !== undefined) {
        arms.push(`catch: (${failure.binding ?? '_error'}) => ${fragment(failure.body, inner)}`)
    }
    if (settled !== undefined) arms.push(`finally: () => ${fragment(settled.body, context)}`)

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

    const moduleBody = blocks.module === null ? '' : blocks.module.body
    const moduleImports =
        blocks.module === null
            ? { imports: [], rest: '' }
            : splitImports(source, blocks.module.start, blocks.module.start + moduleBody.length)

    let setup: { imports: string[]; rest: string } = { imports: [], rest: '' }
    if (blocks.setup !== null) {
        const from = blocks.setup.start
        const to = from + blocks.setup.body.length
        checkNoExport(source, from, to, options.filename)
        setup = splitImports(source, from, to)
    }

    const reactive: Reactive = { cells: new Set(), keyed: new Set() }
    if (blocks.module !== null) {
        reactiveBindings(source, blocks.module.start, blocks.module.start + moduleBody.length, reactive)
    }
    if (blocks.setup !== null) {
        const from = blocks.setup.start
        reactiveBindings(source, from, from + blocks.setup.body.length, reactive)
        reactiveProps(blocks.setup.body, reactive)
    }

    const context: Context = {
        source,
        reactive,
        scope: null,
        eager: false,
        shadow: new Set(),
        hoisted: new Map(),
        used: new Set(),
        counter: { n: 0 },
    }

    // A `<style>` block scopes the component: every element it emits carries the attribute, every
    // selector in it requires that attribute on its rightmost compound, and the rules are registered
    // once at MODULE scope — so by the time anything renders, every imported component has declared
    // its CSS and the server can put the whole sheet in `<head>` without tracking what a render
    // reached.
    let adopted = ''
    if (blocks.styles.length > 0) {
        let css = ''
        for (const block of blocks.styles) css += block.body
        const name = scopeName(options.filename, css)
        context.scope = `data-a${name}`
        adopted = `${need(context, 'adopt')}('${name}', ${JSON.stringify(scopeCss(css, context.scope))})\n`
    }

    // Inline components are hoisted into the setup body so they can be passed as values.
    let defines = ''
    for (const node of blocks.template) {
        if (node.kind === 'define') defines += `    const ${node.name} = ${define(node, context)}\n`
    }

    // The lifted `<script>`/`<style>` blocks were blanked rather than removed, so file offsets stay
    // true for diagnostics; what they leave behind is leading and trailing whitespace in the markup,
    // which would otherwise become real text nodes.
    const markup = children(blocks.template, context).replace(/^\s+/, '\n').replace(/\s+$/, '\n')
    const args = /\btype\s+Args\b/.test(blocks.setup?.body ?? '')
        ? 'args: Args'
        : 'args: Record<string, unknown>'

    // `html` and the return type are always needed; everything else is imported only if the file
    // turned out to use it, so a component that never toggles a class does not import `classes`.
    context.used.add('html')
    const runtime = [...context.used].sort()
    const header = `import { ${runtime.join(', ')}, type TemplateResult } from 'abide'`

    const setupBody = indent(desugarBody(blocks.setup, setup.rest, reactive))
    const assembled =
        mergeImports([header, ...moduleImports.imports, ...setup.imports]) +
        `${desugarBody(blocks.module, moduleImports.rest, reactive)}\n${adopted}` +
        `export default function ${name}(${args}): TemplateResult {\n` +
        `${setupBody}${defines}` +
        `    return html\`${markup}\`\n` +
        `}\n`

    // One pass over the finished string lifts every marker back out, which is why nothing upstream
    // had to carry a generated position around.
    return extract(assembled, source)
}

/**
 * A `<script>` body is desugared too — a write is a statement, so `count = 1` has to work in the
 * same places a person would write it. `expression: false` because a leading `{` there opens a
 * BLOCK, not an object literal.
 */
function desugarBody(
    block: { body: string; start: number } | null,
    rest: string,
    reactive: Reactive,
): string {
    if (block === null || rest.trim() === '') return rest
    // The import-lifted text no longer lines up with the file, so it is desugared as its own region.
    return desugar(rest, 0, rest.length, reactive.cells, { expression: false, keyed: reactive.keyed }).text
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
