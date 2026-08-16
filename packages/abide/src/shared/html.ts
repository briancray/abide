// The shared template representation — the one thing both substrates read.
//
// `html` is a tagged template that captures its static strings and its dynamic values without
// rendering anything. The server interleaves-and-escapes it; the client parses it once into a
// <template> and binds effects to the slots. Neither substrate is allowed its own idea of WHAT a
// slot is: `classifySlots` below is the single classifier, and the two lanes differ only in the
// ACTION they take per kind. The cached form and the two recognisers the substrates share live in
// `$shared/internal/slots.ts`.
//
import { isSource } from './internal/BRANDS.ts'
import { type Cell, derive, isPending, state, untrack } from './internal/graph.ts'
import { isThenable } from './internal/probes.ts'

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
 * The destructuring pattern is also what NAMES the prop cells, which is why the spelling is a
 * binding rather than an `args` object: `{ note: text }` renames the cell, and a rule that read the
 * declared type alone would keep calling it `note` and leave `text` a plain value. Every prop is a
 * cell — see `Props` — so the declared type decides only whether `bind:` may write it.
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

// An ALLOWLIST rather than a list of what breaks out, because the two lanes have to agree and only
// one of them is a string: the client's `setAttribute` validates against XML's `Name`, so a denylist
// wide enough to stop the injection still lets `1abc` through the server and throws in the browser.
// This is `Name` restricted to ASCII — every attribute a real app writes, `data-*` and `aria-*`
// included — and a name outside it is absent from BOTH lanes rather than written by one of them.
const ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/

/**
 * Whether a name may be WRITTEN as an attribute — the second rule both substrates render by.
 *
 * Only a `...spread` carries a name from runtime data; every other attribute name is the compiler's
 * own, out of the template. So this is asked once per spread KEY rather than once per attribute, and
 * the per-node path pays nothing for it.
 *
 * What it is holding: the server concatenates ` ${name}="…"`, so a name carrying a space or a quote
 * closes that attribute and opens whatever follows it — `x onload=alert(1) y` is an event handler on
 * the page. The client could never write that same name, which is why this was a hydration mismatch
 * as well as an injection, and why the rule is here rather than in either renderer.
 */
export function isAttributeName(name: string): boolean {
    return ATTRIBUTE_NAME.test(name)
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
// What a DEFERRING block becomes — `{#if x.pending()}`, an `{#if}` chain that asks about a load. A
// plain marker in the node tree: like `Raw` and `Keyed` it says WHAT this is and leaves the
// substrates to decide what to do about it.
//
// The branches are CLOSURES, and that is the entire point. The slot's thunk evaluates only the
// operand and hands over four unevaluated bodies, so the effect around it subscribes to whatever the
// OPERAND reads and to nothing else. A thunk that chose a branch itself — by reading `pending()` —
// would be woken by the settle, would re-evaluate the operand, and with an inline promise would
// produce a new one forever, with real network requests behind it. Splitting "evaluate the operand"
// from "render a branch" into two effects is the fix, and passing the branches unevaluated is how
// the split is expressed.

// Every field takes an explicit `undefined` as well as being optional: under
// `exactOptionalPropertyTypes` those are different types, and the compiler emits all four keys —
// `undefined` included — so that every deferring block and `{#try}` in an app reaches `settledArms` and
// `ChildPart` as ONE hidden class rather than one per arm combination.
export interface Branches<T = unknown> {
    pending?: (() => unknown) | undefined
    then?: ((value: T) => unknown) | undefined
    catch?: ((error: unknown) => unknown) | undefined
    finally?: (() => unknown) | undefined
}

export class Awaited {
    constructor(
        readonly value: unknown,
        readonly branches: Branches,
    ) {}
}

/**
 * Generic in the operand so the settled arm gets a REAL type: the value is what the promise resolves to, and a
 * cell resolves to what it loaded. The cast is the price of storing every block in one field — a
 * `Branches<T>` is not assignable to `Branches<unknown>` under contravariance, and the alternative is
 * making the marker generic all the way through two substrates for no gain at the use site.
 */
export function awaited<T>(value: PromiseLike<T> | T, branches: Branches<T>): Awaited {
    return new Awaited(value, branches as Branches)
}

/**
 * Start every load this template is going to read, before the walk reaches the first of them.
 *
 * A cell begins its load on the first READ, and in a server render that read is the WALK ARRIVING at
 * the slot — so a page holding three independent loads in three sections costs their SUM rather than
 * their longest. Three 60ms loads rendered in 185ms; started together they render in 63ms, with the
 * same blocking, the same walk and the same complete markup. The only thing that moves is when they
 * begin.
 *
 * The compiler names the cells whose slots are UNCONDITIONAL, so this is the set of loads the walk was
 * going to demand anyway — never a load a branch might not have taken.
 *
 * A throw is swallowed. A body that fails synchronously fails again at the slot that reads it, which
 * is where it was always reported, and one failing load must not keep the others from starting.
 *
 * UNTRACKED, and that is the whole of the difference between kicking a load and subscribing to it.
 * This is called from a component's SETUP, which is itself a tracked run — so a plain read here made
 * the COMPONENT a reader of every load it starts. The component then re-ran when the load settled,
 * and re-running setup built fresh cells and started the load again: `/bench` spun setup → load →
 * setup → load without pause, so the load was never once observed settled, every slot stayed
 * deferred, and the page a reader saw was the server's markup with nothing live in it. The chips did
 * not filter, the filter field would not hold a character, and a handler reading the derived cell got
 * `undefined`. Starting a load is not reading it, and only `untrack` says so.
 */
export function start(sources: readonly (() => unknown)[]): void {
    for (let i = 0; i < sources.length; i++) {
        try {
            untrack(sources[i] as () => unknown)
        } catch {
            // Reported by the read that renders, exactly as before. Starting is never where a
            // failure surfaces.
        }
    }
}

// --- components -----------------------------------------------------------
//
// A component call, CARRIED rather than made. `<Card n={r.n}/>` used to emit `Card({ n: r.n })`, so
// the call happened wherever the enclosing slot thunk ran — and a thunk re-runs for anything the
// parent reads, so every re-render built a new `Card` and every `state()` inside it made a new cell.
// A keyed list gaining one row rebuilt every instance in it, produced output identical to what was
// already on screen, and discarded whatever the user had typed into any of them.
//
// So the call is a marker, exactly as a deferring block and `{#try}` are: the CLIENT holds the instance at
// the part that shows it and writes the props into cells, and the SERVER — a snapshot, with no later
// pass to carry — simply calls it. One more arm on a switch that already has five. See
// docs/COMPONENTS.md.

export class Component {
    constructor(
        readonly view: (props: Record<string, unknown>) => unknown,
        readonly props: Record<string, unknown>,
    ) {}
}

/**
 * What a component's `<script>` receives: the authored prop type, with every prop that is DATA
 * behind a cell.
 *
 * The author writes `props<{ n: number }>()` and means "this component is given a number". What the
 * position holding the instance hands over is a cell it writes on every pass, so `{n}` re-renders on
 * a new `n` for the same reason `{own}` re-renders on a write — and `{n + 1}` compiles to `n() + 1`,
 * because a prop name is a cell like every other name in scope.
 *
 * Two things pass through untouched — see `passedThrough`, which is the value-level spelling of the
 * same rule and the one both substrates test.
 */
// `NonNullable` because an OPTIONAL member carries `undefined` into `T[K]`, and `fn | undefined`
// extends neither arm — so `onpick?: (t: string) => void` mapped to a cell of a callback, and the
// only thing that said so was the `@click` that attached the cell.
export type Props<T> = {
    [K in keyof T]: NonNullable<T[K]> extends ((...args: never[]) => unknown) | Cell<unknown>
        ? T[K]
        : Cell<T[K]>
}

/**
 * `<Card n={r.n}/>`. The props are PLAIN VALUES, not thunks: what makes them live is the cell the
 * instance holds for each of them, which the position writes into on every pass. A thunk per prop
 * would have had to be rebuilt per pass anyway — `rows().map((r) => …)` closes over THAT pass's `r`,
 * so an instance caching the first one would read a row object since replaced.
 *
 * `Given` is the inverse of `Props`: what the CALL SITE may write, which is the value or the cell. It
 * is what keeps a mistyped prop an error where the mistake is, now that the call goes through a
 * helper rather than being written out.
 */
export type Given<P> = { [K in keyof P]: P[K] extends Cell<infer V> ? Cell<V> | V : P[K] }

export function component<P extends Record<string, unknown>>(
    view: (props: P) => unknown,
    props: Given<P>,
): Component {
    return new Component(
        view as unknown as (props: Record<string, unknown>) => unknown,
        props as Record<string, unknown>,
    )
}

/**
 * One cell per prop, made once, at the instance's first pass — by whichever substrate is showing it.
 *
 * A component's props are CELLS, on both sides. The client needs that so a later pass is a write
 * rather than a rebuilt child; the server has no later pass and makes them anyway, because the other
 * rule is that a component is written once and runs in both places. A server that handed the plain
 * values over would work for every compiled `.abide` file — those bind through `propCell`, which
 * would make the cells — and break every hand-written `.ts` component, which reads `who()` on a
 * string. One rule is cheaper than that exception.
 *
 * What does NOT get a cell is `passedThrough`'s question.
 *
 * Grown key-by-key on purpose, and `{ ...props }` first was tried and reverted: seeding the record
 * with a spread costs one map transition instead of one per prop, but it READS every prop twice —
 * once for the spread and once for `props[name]` — and a prop is not always a plain field. It turned
 * `/docs/syntax/for` rung 7 into a substrate disagreement. Anything faster here has to keep the read
 * count at one per prop.
 */
export function cellProps(props: Record<string, unknown>): Record<string, unknown> {
    const made: Record<string, unknown> = {}
    for (const name in props) {
        const value = props[name]
        made[name] = passedThrough(value) ? value : state(value)
    }
    return made
}

/**
 * Whether a prop reaches the child UNTOUCHED rather than behind a cell.
 *
 * Two things do: something ALREADY a source — `bind:note={note}` needs the child to hold the very
 * cell the parent does, not a copy — and a FUNCTION, which is a callback rather than data and is
 * called, not read. The two collapse to one test, because a source IS a function — see `isSource`,
 * whose brand check is what the second arm would otherwise have had to repeat.
 *
 * Named rather than spelled at each site: `cellProps` here, `writeProps` in `$ui/internal/parts.ts`
 * and `Props<T>` above all make exactly these exceptions, and a third one added to one of them
 * would be silently absent from the others.
 */
export function passedThrough(value: unknown): boolean {
    return typeof value === 'function'
}

/**
 * One prop, as the child's `<script>` binds it — emitted by the compiler for every name the
 * `props<T>()` destructure brought into scope.
 *
 * Nearly always a pass-through, because `cellProps` above already made the cell. What it is FOR is
 * the prop that never arrived: a call site that omits an optional prop emits no key for it, so the
 * local would be `undefined` where the template is about to call it, and a destructure default would
 * satisfy it with a plain string — leaving the local `'' | Cell<string>`, only one of which is
 * callable. So the default is lifted out of the pattern to here, and derived rather than folded in
 * once, so an `undefined` arriving LATER on a live cell still reads as the default.
 */
// A CELL in both overloads, never `Cell<T> | T`: the union would leave `T` inferrable from either
// arm, and `propCell($class, '')` then read `T` as the cell itself and handed back a cell of a cell.
// The server's plain value is a fact about the runtime — `emit`'s `Component` arm calls the view with
// what the caller wrote — and the parameter type describes the CLIENT, which is what an author's
// `assertType` is checking.
export function propCell<T>(given: Cell<T> | undefined): Cell<T>
export function propCell<T, D>(given: Cell<T> | undefined, fallback: D): Cell<NonNullable<T> | D>
export function propCell(given: unknown, fallback?: unknown): Cell<unknown> {
    if (isSource(given)) {
        const cell = given as Cell<unknown>
        return fallback === undefined ? cell : derive(() => cell() ?? fallback)
    }
    return state(given === undefined ? fallback : given)
}

// --- boundaries and streams -----------------------------------------------
//
// `{#try}` and `{#for await}`, the same way: a marker carrying unevaluated work, and one case per
// substrate. Neither needs anything the `Awaited` case did not already need.

export class Boundary {
    constructor(
        readonly body: () => unknown,
        readonly branches: Branches,
        /**
         * Does the body hold an `{await …}`? Written by the compiler, which knows syntactically.
         *
         * A flag rather than a probe because it decides whether `settledBoundary` WALKS at all: every
         * `{#try}` ever written is `false` here and pays exactly nothing, and the walk is the cost of
         * having asked for an await.
         */
        readonly awaiting: boolean = false,
    ) {}
}

/**
 * `{#try}`. The body is a THUNK, and the boundary is the one place the compiler does not give each
 * expression its own thunk: an expression that produced its value in a nested effect would throw
 * there, past this try/catch, and the boundary would catch nothing. So a boundary is one unit — it
 * renders or it catches — and the cost is that any dependency inside it re-runs the whole body.
 *
 * An `{await …}` inside the body IS caught, and `awaiting` is what says to look: the hole compiles to
 * an invoked async IIFE, so the body still runs SYNCHRONOUSLY and a source read inside it still
 * signals — see `settledBoundary`, which is where the promises it left behind are collected. Making
 * the body itself `async` would have been the shorter route and it is the wrong one: an async function
 * converts every throw into a rejection, pending SIGNALS included, so a cell read inside a `{#try}`
 * would stop deferring and serve nothing at all, silently.
 */
export function boundary(body: () => unknown, branches: Branches, awaiting = false): Boundary {
    return new Boundary(body, branches, awaiting)
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
 * The settled arms, in render order: the branch that matched, then `finally` if there is one.
 *
 * ONE payload, because a settle has one: `failed` says which arm it belongs to. Spelled as an error
 * and a value side by side, every one of the eight call sites had to pass `undefined` to the slot the
 * boolean was about to disable, which is a hole an argument order can be got wrong in silently.
 */
export function settledArms(branches: Branches, failed: boolean, settled: unknown): unknown[] {
    const arm = failed ? branches.catch?.(settled) : branches.then?.(settled as never)
    return branches.finally === undefined ? [arm] : [arm, branches.finally()]
}

/**
 * The arm shown WHILE the load runs, in the shape the settle will replace it with — where it can be.
 *
 * The SHAPE is the whole of this, and it belongs beside `settledArms` because that is what decides
 * it. A settle lands as an array; a pending arm handed over bare makes the settle cross from the
 * template arm of `ChildPart.set` to its ARRAY arm, and those two never meet — the array arm cannot
 * reach the `strings` identity cutoff, so it tears the nested instance down and rebuilds the whole
 * region through a list to paint what it already had. The compiler hands all three branches the SAME
 * thunk, so both passes produce the same template from the same call site; agreeing on the shape is
 * what lets the settle be the patch the emit has always described it as.
 *
 * Conditional to keep `null` — the common case, a block with no `pending` at all — from building a
 * `ListPart` and an instance to paint nothing. `Branches.pending` is typed `() => unknown`, so a
 * hand-written `awaited()` may also answer with a string; that stays bare too, and it is the one
 * arm where this function does not get what it wants: the settle still lands as an array, so a
 * STRING pending arm crosses the two arms of `ChildPart.set` exactly as the paragraph above
 * describes. Wrapping it instead trades that crossing for a per-block instance, and which is
 * cheaper is unmeasured. `templateOf` is what makes the choice available — a wrapped row no longer
 * has to be a template, so `ListPart` is no longer what decides this.
 *
 * `finally` is absent on purpose: it belongs to a settle that has not happened, and the array
 * growing by one is how it arrives.
 */
export function pendingArm(branches: Branches): unknown {
    const arm = branches.pending?.() ?? null
    return isTemplate(arm) ? [arm] : arm
}

/**
 * What the body PRODUCED — its `{:finally}` arm included — and the promises it left behind, without
 * collapsing the two together.
 *
 * The split exists for hydration. A boundary body runs synchronously even when it awaits — the holes
 * are what defer, not the body — so the STRUCTURE is knowable the moment the body returns, and only
 * the awaiting holes are not. `settledBoundary` folds both into one promise, which is right for a
 * renderer that just wants the answer and wrong for `take`, which would then see an opaque promise
 * and replace server nodes it could have adopted. `waiting` is empty for every `{#try}` with no
 * await in it.
 *
 * `finally` is applied HERE and not one layer up, and that is a fix rather than a tidy: it used to be
 * `settledBoundary`'s, so `take` claimed the body alone and the arm's nodes — which the server had
 * already written into the same range — were left over. The adopt then reported a mismatch and rebuilt
 * a region it had been handed correct markup for, on every `{#try}` in the repo that has the arm. The
 * output was identical either way, which is why only the hydrate COUNTERS could see it.
 */
export function producedBoundary(block: Boundary): { produced: unknown; waiting: PromiseLike<unknown>[] } {
    let produced: unknown
    try {
        produced = block.body()
    } catch (error) {
        // A read with nothing to serve YET is not a failure, and this is not the boundary that
        // recovers from it: the signal passes through to whoever will run the body again.
        if (isPending(error) || block.branches.catch === undefined) throw error
        return { produced: settledArms(block.branches, true, error), waiting: [] }
    }
    const waiting: PromiseLike<unknown>[] = []
    // Collected off the BODY rather than off what is returned: the `{:finally}` arm is not what the
    // boundary is waiting on, and walking it would put its holes into the same `Promise.all`.
    if (block.awaiting) collectThenables(produced, waiting, 0)
    const settled = block.branches.finally
    return { produced: settled === undefined ? produced : [produced, settled()], waiting }
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
    const { produced, waiting } = producedBoundary(block)
    // An `{await …}` in the body left a promise in a slot, and a promise rejecting later is the
    // failure this boundary exists to claim. The promises are NOT replaced: the renderer resolves
    // them itself, and awaiting one twice costs nothing — all this decides is whether the body's
    // result or the catch arm is what gets rendered.
    if (waiting.length > 0) {
        return Promise.all(waiting).then(
            () => produced,
            (error: unknown) => {
                if (isPending(error) || block.branches.catch === undefined) throw error
                return settledArms(block.branches, true, error)
            },
        )
    }
    return produced
}

/**
 * Every promise a boundary body left in its slots, including in the templates nested inside it.
 *
 * `depth` is a guard rather than a budget: a body is a tree the compiler emitted, so it is bounded by
 * the source, but a value handed IN can be a cycle and this walk is not the place to discover that.
 */
function collectThenables(value: unknown, into: PromiseLike<unknown>[], depth: number): void {
    if (depth > 16 || value === null || typeof value !== 'object') return
    if (isThenable(value)) {
        into.push(value)
        return
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) collectThenables(value[i], into, depth + 1)
        return
    }
    if (isTemplate(value)) {
        const values = value.values
        for (let i = 0; i < values.length; i++) collectThenables(values[i], into, depth + 1)
    }
}

// --- the one classifier ---------------------------------------------------

/**
 * ONE shape, discriminated by `kind`, rather than six variants — a child slot carries `name: ''` and
 * `staticTail: 0` rather than omitting them.
 *
 * The array `classifySlots` returns is cached per template and re-walked on every instantiation, so
 * a thousand-row list reads it a thousand times; two element shapes in it made `kind.kind` at
 * `$server`'s `emitTemplate` a polymorphic load for a discriminant every element carries anyway. The
 * client lane does not re-walk this array at all — `prepare` projects what it needs out of it once
 * per template — so the cost was the server's alone.
 */
export interface SlotKind {
    kind: 'child' | 'attr' | 'event' | 'property' | 'ref' | 'spread'
    /** Empty for a child slot and for a spread, whose names arrive with the value. */
    name: string
    /** How many characters of the preceding static string are the `name=` markup. 0 for a child. */
    staticTail: number
}

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
            kinds.push({ kind: 'child', name: '', staticTail: 0 })
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

// Hoisted, for `wire.ts`'s reason: a regex LITERAL builds a fresh `RegExp` every time it is
// evaluated, and this pair is evaluated per interpolated text node and per attribute value on the
// server walk. The two spellings are one probe and one replace, so the `g` one's `lastIndex` is
// reset by `replace` itself and never read.
const ESCAPABLE = /[&<>"']/
const ESCAPABLE_ALL = /[&<>"']/g

export function escape(value: string): string {
    // Probe before replacing — most interpolated text has nothing to escape, and `replace` with a
    // callback allocates per hit.
    if (!ESCAPABLE.test(value)) return value
    return value.replace(ESCAPABLE_ALL, (c) => ESCAPES[c] as string)
}

/**
 * ` nonce="…"`, or nothing at all when this render has no policy to satisfy.
 *
 * The value is base64url out of `nonce()`, so there is nothing in it that needs escaping — which is
 * also why the quoting here can be a plain interpolation rather than `attribute()`.
 *
 * Here rather than beside either writer because both lanes stamp one: the server's patch and deferred
 * scripts, and the seed block the client reads back.
 */
export function nonceAttribute(nonce: string | null): string {
    return nonce === null ? '' : ` nonce="${nonce}"`
}
