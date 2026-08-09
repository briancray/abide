// The shared template representation — the one thing both substrates read.
//
// `html` is a tagged template that captures its static strings and its dynamic values without
// rendering anything. The server interleaves-and-escapes it; the client parses it once into a
// <template> and binds effects to the slots. Neither substrate is allowed its own idea of WHAT a
// slot is: `classifySlots` below is the single classifier, and the two lanes differ only in the
// ACTION they take per kind. The cached form and the two recognisers the substrates share live in
// `$shared/internal/slots.ts`.
//
const TEMPLATE_BRAND = Symbol.for('abide.template')

export interface TemplateResult {
    readonly [TEMPLATE_BRAND]: true
    readonly strings: readonly string[]
    readonly values: readonly unknown[]
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): TemplateResult {
    return { [TEMPLATE_BRAND]: true, strings, values }
}

export function isTemplate(value: unknown): value is TemplateResult {
    return typeof value === 'object' && value !== null && TEMPLATE_BRAND in value
}

/**
 * A component's props, bound where they are declared.
 *
 * Erased by the compiler: `const { class: name = '' } = props<Card>()` becomes a destructure of the
 * emitted function's parameter, and the type argument BECOMES that parameter's type. It is a real
 * export rather than a bare identifier the compiler happens to know so that a `.abide` `<script>`
 * keeps the property every other line of it has — every name in scope was imported or declared by
 * the author — and so the same text type-checks as ordinary TypeScript.
 *
 * The destructuring pattern is also where a cell prop is RECOGNISED, which is why the spelling is a
 * binding rather than an `args` object: `{ note: text }` renames the cell, and a rule that read the
 * declared type alone would keep calling it `note` and leave `text` a plain value.
 */
export function props<T = Record<string, unknown>>(): T {
    throw new Error(
        'abide: props() is compiler-erased — it can only be called in a .abide <script>, where it ' +
            'becomes the component function’s parameter.',
    )
}

export class Raw {
    constructor(readonly html: string) {}
}
export const raw = (html: string): Raw => new Raw(html)

/**
 * What a value means in ATTRIBUTE position — the one rule both substrates render by.
 *
 * `null` — the attribute is absent. `true` — present with no value. Anything else is its text. The
 * two lanes have to agree here or the client's first update rewrites markup the server already got
 * right, which is a hydration mismatch nothing else catches.
 */
export function attributeText(value: unknown): string | null | true {
    if (value === null || value === undefined || value === false) return null
    if (value === true) return true
    return String(value)
}

// --- list keys ------------------------------------------------------------
//
// A key is a plain data marker, not a renderer concept: it says WHICH row this is, and only the
// client has anything to do with that (moving DOM instead of rewriting it). It lives here rather
// than in `$ui` because a template is authored once for both substrates — a keyed list handed to
// `renderToString` has to render its rows, not stringify the wrappers, and that stopped being
// hypothetical the moment `{#for … by key}` started emitting `keyed(...)` into isomorphic code.
//
// The symbol comes from the global registry for the same reason `TEMPLATE_BRAND` does: both
// substrates must recognise one without sharing a module instance.
export const KEY = Symbol.for('abide.key')

export interface Keyed {
    readonly [KEY]: unknown
    readonly template: TemplateResult
}

/** Mark a list item so a reorder MOVES its DOM instead of rewriting it. */
export function keyed(key: unknown, template: TemplateResult): Keyed {
    return { [KEY]: key, template }
}

export function isKeyed(value: unknown): value is Keyed {
    return typeof value === 'object' && value !== null && KEY in value
}

// --- awaiting -------------------------------------------------------------
//
// What `{#await}` becomes. A plain marker in the node tree — like `Raw` and `Keyed`, it says WHAT
// this is and leaves the substrates to decide what to do about it.
//
// The branches are CLOSURES, and that is the entire point. The slot's thunk evaluates the operand
// and hands over four unevaluated bodies, so the effect around it subscribes to whatever the OPERAND
// reads and to nothing else. A helper that returned a cell instead could not do this: the thunk
// would have to read `pending()` to choose a branch, so settling would wake the thunk, which would
// re-evaluate the operand, which would produce a new promise — forever, with real network requests
// behind it. Splitting "evaluate the operand" from "render a branch" into two effects is the fix,
// and passing the branches unevaluated is how the split is expressed.

export interface Branches<T = unknown> {
    pending?: () => unknown
    then?: (value: T) => unknown
    catch?: (error: unknown) => unknown
    finally?: () => unknown
}

export class Awaited {
    constructor(
        readonly value: unknown,
        readonly branches: Branches,
    ) {}
}

/**
 * Generic in the operand so `{:then v}` gets a REAL type: `v` is what the promise resolves to, and a
 * cell resolves to what it loaded. The cast is the price of storing every block in one field — a
 * `Branches<T>` is not assignable to `Branches<unknown>` under contravariance, and the alternative is
 * making the marker generic all the way through two substrates for no gain at the use site.
 */
export function awaited<T>(value: PromiseLike<T> | T, branches: Branches<T>): Awaited {
    return new Awaited(value, branches as Branches)
}

// --- boundaries and streams -----------------------------------------------
//
// `{#try}` and `{#for await}`, the same way: a marker carrying unevaluated work, and one case per
// substrate. Neither needs anything the `Awaited` case did not already need.

export class Boundary {
    constructor(
        readonly body: () => unknown,
        readonly branches: Branches,
    ) {}
}

/**
 * `{#try}`. The body is a THUNK, and the boundary is the one place the compiler does not give each
 * expression its own thunk: an expression that produced its value in a nested effect would throw
 * there, past this try/catch, and the boundary would catch nothing. So a boundary is one unit — it
 * renders or it catches — and the cost is that any dependency inside it re-runs the whole body.
 * Asynchronous failures are not caught, for the same reason a JavaScript `try` does not catch them.
 */
export function boundary(body: () => unknown, branches: Branches): Boundary {
    return new Boundary(body, branches)
}

export class Streamed {
    constructor(
        readonly source: unknown,
        readonly row: (item: never, index: number) => unknown,
        readonly failure: ((error: unknown) => unknown) | undefined,
    ) {}
}

/**
 * `{#for await}`. Reactive rather than one-shot: the enclosing effect re-runs when the source's
 * dependencies move, and a new source tears the list down and re-streams it.
 */
export function streamed<T>(
    source: AsyncIterable<T> | Iterable<T>,
    row: (item: T, index: number) => unknown,
    failure?: (error: unknown) => unknown,
): Streamed {
    return new Streamed(source, row as (item: never, index: number) => unknown, failure)
}

/**
 * A subtree the author asked to be rendered OUT OF ORDER — the one async marker that is about when
 * the markup is sent rather than about what the value is.
 *
 * Here beside the other three rather than in `$server`, and that is the whole of what makes it usable
 * in a PAGE. A page is isomorphic by construction: the same module renders on the server and then
 * hydrates in the browser. A marker only one substrate knows is one the other stringifies —
 * `[object Object]` on screen, and a hydration mismatch behind it — so a server-only `suspend` is a
 * primitive every page is locked out of, which is not what "how a load reaches SSR" should mean.
 *
 * A plain marker carrying unevaluated work, like `Awaited` above it: the walker hands out the id when
 * it reaches one, so nothing ambient has to correlate a placeholder with its patch.
 */
export class Suspend {
    constructor(
        readonly value: unknown,
        readonly body: (value: never) => unknown,
        readonly fallback: unknown,
    ) {}
}

/**
 * Render `body(value)` when `value` settles, showing `fallback` until it does.
 *
 * `PromiseLike` rather than `Promise` so a cell can be suspended directly: `state`/`memo` are
 * thenable, and this is how a load reaches a server render, where there is nothing to wake later.
 *
 * The two substrates read the same marker and differ only in what "out of order" can mean for them.
 * A document render defers the subtree and patches it in as it settles; a render with nowhere to
 * patch awaits it inline; the client shows the fallback and swaps when the promise lands, which is
 * the ordinary reactive thing it already does for a promise in a slot. Same call, same intent, three
 * continuations — which is the rule the rest of this file follows.
 */
export function suspend<T>(
    value: PromiseLike<T> | T,
    body: (value: T) => unknown,
    fallback: unknown = null,
): Suspend {
    return new Suspend(value, body as (value: never) => unknown, fallback)
}

/** The settled arms, in render order: the branch that matched, then `finally` if there is one. */
export function settledArms(branches: Branches, error: unknown, value: unknown, failed: boolean): unknown[] {
    const arm = failed ? branches.catch?.(error) : branches.then?.(value as never)
    return branches.finally === undefined ? [arm] : [arm, branches.finally()]
}

/**
 * What a `{#try}` renders to: the body, or the catch arm if producing it threw.
 *
 * Both substrates run the body the SAME way and differ only in what they do with the result — the
 * client claims server nodes with it or writes it into a part, the server emits it — so the decision
 * lives here and each substrate keeps only its continuation. Without a `{:catch}` the author did not
 * claim to handle it, so the throw passes through and this boundary catches nothing.
 */
export function settledBoundary(block: Boundary): unknown {
    let produced: unknown
    try {
        produced = block.body()
    } catch (error) {
        if (block.branches.catch === undefined) throw error
        return settledArms(block.branches, error, undefined, true)
    }
    const settled = block.branches.finally
    return settled === undefined ? produced : [produced, settled()]
}

// --- the one classifier ---------------------------------------------------

export type SlotKind =
    | { kind: 'child' }
    | { kind: 'attr'; name: string; staticTail: number }
    | { kind: 'event'; name: string; staticTail: number }
    | { kind: 'property'; name: string; staticTail: number }
    | { kind: 'ref'; name: string; staticTail: number }
    | { kind: 'spread'; name: string; staticTail: number }

// Attribute slots are recognised from the tail of the static string that precedes them:
//   `<a href=${url}>`      -> attr href
//   `<button @click=${f}>` -> event click
//   `<input .value=${v}>`  -> property value   (a DOM property, never an attribute)
//   `<div &ref=${node}>`   -> ref             (the NODE itself, so client-only)
//   `<div ...=${props}>`   -> spread          (names not known until the value arrives)
// `staticTail` is how many characters to strip off that static string, since `href=` is markup the
// server must not emit verbatim.
//
// The four sigils are `.` `@` `&` and `...`, and they are all the vocabulary there is: a slot inside
// a tag is one of these or it is an attribute.
const ATTR_TAIL = /\s(\.\.\.|[.@&]?[a-zA-Z_][\w:.-]*)=$/

// Walk the static strings tracking whether we are inside a tag, so slot i can be classified without
// parsing HTML. Quotes inside a tag are tracked so `title="a > b"` does not close it early.
export function classifySlots(strings: readonly string[]): SlotKind[] {
    const kinds: SlotKind[] = []
    let inTag = false
    let inComment = false
    let quote = ''

    for (let i = 0; i < strings.length - 1; i++) {
        const text = strings[i] as string
        for (let c = 0; c < text.length; c++) {
            const char = text[c] as string
            // A comment is not a tag, and nothing inside one is markup: an apostrophe in a sentence
            // would otherwise open an attribute value that never closes, and every slot after it in
            // the template would be classified as sitting inside a tag. Tracked ACROSS strings
            // because a comment may hold a slot, and the state that carries it is the flag.
            if (inComment) {
                if (char === '-' && text.startsWith('->', c + 1)) {
                    inComment = false
                    c += 2
                }
                continue
            }
            if (quote !== '') {
                if (char === quote) quote = ''
                continue
            }
            if (char === '<' && text.startsWith('!--', c + 1)) {
                inComment = true
                c += 3
            } else if (inTag && (char === '"' || char === "'")) quote = char
            else if (char === '<') inTag = true
            else if (char === '>') inTag = false
        }

        if (!inTag) {
            kinds.push({ kind: 'child' })
            continue
        }
        const match = ATTR_TAIL.exec(text)
        if (match === null) {
            throw new SyntaxError(
                `abide: a slot inside a tag must be a whole attribute value written as ` +
                    `name=\${...} (unquoted). Got: ...${text.slice(-24)}\${...}`,
            )
        }
        const rawName = match[1] as string
        // Consume the separating whitespace too: every consumer re-emits its own leading space
        // (` href="x"`, ` data-$0=""`), so keeping it here would double it — and an event slot,
        // which emits nothing at all, would leave a stray one behind.
        const staticTail = match[0].length
        if (rawName === '...') {
            kinds.push({ kind: 'spread', name: '', staticTail })
        } else if (rawName.startsWith('@')) {
            kinds.push({ kind: 'event', name: rawName.slice(1), staticTail })
        } else if (rawName.startsWith('.')) {
            kinds.push({ kind: 'property', name: rawName.slice(1), staticTail })
        } else if (rawName.startsWith('&')) {
            kinds.push({ kind: 'ref', name: rawName.slice(1), staticTail })
        } else {
            kinds.push({ kind: 'attr', name: rawName, staticTail })
        }
    }
    return kinds
}

const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}

export function escape(value: string): string {
    // Probe before replacing — most interpolated text has nothing to escape, and `replace` with a
    // callback allocates per hit.
    if (!/[&<>"']/.test(value)) return value
    return value.replace(/[&<>"']/g, (c) => ESCAPES[c] as string)
}
