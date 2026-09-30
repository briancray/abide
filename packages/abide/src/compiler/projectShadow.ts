import { isEventName } from '#shared/isEventName.ts'
import { isComponentTag, propKeyOf } from './classifyTemplate.ts'
import { isNamedAlone } from './isNamedAlone.ts'
import type { AbideFile } from './parseAbide.ts'
import type { Branch, Setup, TemplateNode } from './TemplateNode.ts'
import { tokenise } from './tokenise.ts'

export type Span = { start: number; end: number }

/**
 * A `.abide` file as one TypeScript program, with where each piece of it came from.
 *
 * A `.abide` FILE AS ONE TYPESCRIPT PROGRAM: its `<script module>`, its `<script>`, and every
 * expression its template holds, each where the scopes it stands in are. The checker reads this
 * text and answers, per occurrence, which binding a name reaches (31.3) — and the emitters lower
 * the same text, span by span, so an offset means one thing on both sides.
 *
 * 31.10 FALLS OUT OF THE SHAPE. A `{#for}` is a `for … of` binding its item and its index, so the
 * body's slots reach the row's binding and never the page's name of the same spelling. The SUBJECT
 * stands before the loop, because 31.10's shadow does not reach it.
 *
 * EVERY EXPRESSION IS ITS OWN STATEMENT, `;(…)`, so an author's script that ends without a
 * semicolon cannot run into the first slot, and a slot's own right-hand side ends at its `)`.
 */
export type Projection = {
    text: string
    modules: Span
    scripts: Span
    /**
     * Per holder — an expression node, an attribute, an `{#if}` arm, a `{#for}` block — the span of
     * the expression it holds.
     */
    slots: Map<object, Span>
    /**
     * Per `{#for}` block, the span of its `by` key, which stands inside the loop and sees the row.
     */
    keys: Map<object, Span>
    /**
     * 32.35 — per invocation, the span of its tag: a read there is a component chosen by a value.
     */
    tags: Map<object, Span>
    /**
     * 14.8 — every branch-local `<script>`, whose declarations are names as the page's are (31.1).
     */
    setups: Span[]
    /**
     * 38.3 — every run of the text copied out of the source, ascending, with where it came from.
     * What lies between two is scaffolding the source never held.
     */
    origins: Origin[]
}

/** A run of projected text copied from the source: where it lands, where from, and how long. */
export type Origin = { at: number; source: number; length: number }

/**
 * Each parsed file's projection, made once.
 *
 * ONE PROJECTION PER PARSED FILE. The checker asks of it and both emitters lower it, and a build
 * hands all three the same `AbideFile` — projected per caller it was three walks and three copies
 * of the file's text for one answer.
 */
const PROJECTED = new WeakMap<AbideFile, Projection>()

/** The file's projection, made once per parsed `AbideFile`. */
export function projectShadow(file: AbideFile): Projection {
    let projection = PROJECTED.get(file)
    if (projection === undefined) {
        projection = project(file)
        PROJECTED.set(file, projection)
    }
    return projection
}

function project(file: AbideFile): Projection {
    const origins: Origin[] = []
    let text = ''
    // What is written next came from `origin` in the `.abide`, where the parser found one.
    const place = (origin: number | undefined, length: number): void => {
        if (origin !== undefined)
            origins.push({ at: text.length, source: origin, length })
    }
    // `source` copied verbatim from `origin`, and the span it lands at.
    const copied = (source: string, origin: number | undefined): Span => {
        const start = text.length
        place(origin, source.length)
        text += source
        return { start, end: text.length }
    }

    // Blocks of one kind, joined as the file wrote them, each run placed where it stood.
    const blocks = (bodies: string[], starts: number[]): Span => {
        const start = text.length
        for (let at = 0; at < bodies.length; at += 1) {
            if (at > 0) text += '\n'
            copied(bodies[at] as string, starts[at])
        }
        return { start, end: text.length }
    }
    const modules = blocks(file.modules, file.origins.modules)
    text += '\n;\n'
    const scripts = blocks(file.scripts, file.origins.scripts)
    const scriptsText = text.slice(scripts.start, scripts.end)
    text += '\n'
    const slots = new Map<object, Span>()
    const keys = new Map<object, Span>()
    const tags = new Map<object, Span>()
    const setups: Span[] = []

    // `open` is what the statement starts with: a bare parenthesis, or a call that hands the value
    // the type its position gives it (`openerOf`).
    const expression = (
        source: string,
        origin: number | undefined,
        open = '(',
    ): Span => {
        text += `;${open}`
        const span = copied(source, origin)
        text += ')\n'
        return span
    }

    let subjects = 0

    // 14.8 — A BRANCH-LOCAL `<script>` IS STATEMENTS AT THE HEAD OF ITS BODY, inside the loop or the
    // braces that scope it, so its names are the body's and the checker reads it as the body does.
    const setup = (owned: Setup | null): void => {
        if (owned === null) return
        const span = copied(owned.text, file.origins.holders.get(owned))
        slots.set(owned, span)
        setups.push(span)
        text += '\n'
        refuseTopLevelAwait(owned.text, 'branch-local <script>')
    }

    // 32.18 — A COMPONENT TAG IS A CALL, AND IT IS PROJECTED AS ONE: the name it invokes, handed the
    // record the build hands it (`invocationProps`), so the checker holds each value to the prop the
    // child declares (33.4), reports a name nobody imported, and answers a hover or a jump on the
    // tag with the import's (38.40). Spreads first and explicit keys after, which is the order 33.12
    // resolves them in. A value is wrapped in `__prop` rather than in bare parentheses, so
    // `proveSlots` does not take a prop for a template position.
    const invocation = (
        node: Extract<TemplateNode, { kind: 'element' }>,
    ): void => {
        // 32.37 — CALLED OPTIONALLY, so a value that may be absent is checked as one that may
        // render nothing; a tag that is always a component reads the same either way.
        //
        // 32.35 — AND THE STATEMENT IS THE PARENTHESES, NOT THE CALL. A call standing as a statement
        // is one the checker asks whether it ASSERTS, which it answers from the callee's type while
        // it is still walking the flow — so a callee whose type is `ReturnType<typeof Shown>`
        // reached back into `Shown`'s own initializer and reported it circular (TS2502).
        text += ';(('
        tags.set(node, copied(node.tag, file.origins.holders.get(node)))
        text += ')?.({\n'
        // 32.6 — a `bind:` hands over the caller's `Reactive` or a `{ get, set }` pair, held to
        // the prop as the value it holds, and marked for `propsReads` as a name the child hands on.
        const prop = (attribute: (typeof node.attributes)[number]): void => {
            text += attribute.lowerName.startsWith('bind:')
                ? `${BOUND}(`
                : `${PROP}(`
            slots.set(
                attribute,
                copied(attribute.value, file.origins.holders.get(attribute)),
            )
            text += '),\n'
        }
        for (const attribute of node.attributes)
            if (attribute.name === '...' && attribute.expression) {
                text += '...'
                prop(attribute)
            }
        // 32.10 — a name `propKeyOf` keys no prop by, and the build refuses it on a component.
        const refused: typeof node.attributes = []
        for (const attribute of node.attributes) {
            if (attribute.name === '...') continue
            const key = propKeyOf(attribute)
            if (key === undefined) {
                if (attribute.expression) refused.push(attribute)
                continue
            }
            // The key is scaffolding, and a finding on it — a value of the wrong type, a prop the
            // child does not declare — is placed at the value it keys, or a literal's name.
            place(file.origins.holders.get(attribute), 0)
            text += `${JSON.stringify(key)}: `
            if (attribute.expression) prop(attribute)
            else text += `${JSON.stringify(attribute.value)},\n`
        }
        text += '}))\n'
        for (const attribute of refused)
            slots.set(
                attribute,
                expression(
                    attribute.value,
                    file.origins.holders.get(attribute),
                    `${ANY}(`,
                ),
            )
    }

    const walk = (nodes: TemplateNode[]): void => {
        for (const node of nodes) {
            if (node.kind === 'text') continue
            if (node.kind === 'expression') {
                slots.set(
                    node,
                    expression(node.source, file.origins.holders.get(node)),
                )
                continue
            }
            if (node.kind === 'element') {
                if (isComponentTag(node.tag) && isNamedAlone(node.tag)) {
                    invocation(node)
                    walk(node.children)
                    continue
                }
                for (const attribute of node.attributes)
                    if (attribute.expression)
                        slots.set(
                            attribute,
                            expression(
                                attribute.value,
                                file.origins.holders.get(attribute),
                                openerOf(node.tag, attribute.lowerName),
                            ),
                        )
                walk(node.children)
                continue
            }
            // 32.16 — the catch arm binds the failure, and the checker has to see the name.
            if (node.block === 'try') {
                walk((node.branches[0] as Branch).children)
                text += `{ const ${node.error === '' ? '__failure' : node.error}: any = undefined\n`
                walk((node.branches[1] as Branch).children)
                text += '}\n'
                continue
            }
            // AN `{#if}` IS PROJECTED AS THE `if` IT IS, so an arm is checked under what its condition
            // established: `{#if contact}{contact.name}` is a `Contact` there, a discriminant
            // narrows its union, and `{:else}` has the rest. Written as a bare `(subject)` statement
            // beside its arms, every arm was checked as if the condition had never been asked.
            //
            // THE SUBJECT IS DOUBLY PARENTHESISED: the `if`'s own parentheses are not an expression,
            // and a position is found by the parenthesised expression it opens (`proveSlots`). The
            // braces are also what scope an arm's branch-local `<script>` (14.8).
            if (node.block === 'if') {
                let first = true
                for (const branch of node.branches) {
                    if (branch.subject === '') text += ' else {\n'
                    else {
                        text += first ? ';if ((' : ' else if (('
                        slots.set(
                            branch,
                            copied(
                                branch.subject,
                                file.origins.holders.get(branch),
                            ),
                        )
                        text += ')) {\n'
                    }
                    first = false
                    setup(branch.setup)
                    walk(branch.children)
                    text += '}'
                }
                text += '\n'
                continue
            }
            // THE ROW'S ITEM IS TYPED FROM THE SUBJECT, so a member of it is a member the checker
            // can answer for (`proveStatic`) — bound `any`, `{row.title}` was unprovable in every
            // row of every list. The subject is held in a `const` of its own rather than written
            // into the loop's head, where the item's own binding is already in scope.
            const subject = `${SUBJECT}${subjects}`
            subjects += 1
            text += `;const ${subject} = (`
            slots.set(
                node,
                copied(node.subject, file.origins.holders.get(node)),
            )
            text += ')\n'
            text += `for (const ${node.item} of ${ROWS_OF}(${subject})) {\n`
            if (node.index !== '') text += `const ${node.index} = 0\n`
            setup(node.setup)
            if (node.key !== '')
                keys.set(
                    node,
                    expression(node.key, file.origins.keys.get(node)),
                )
            walk(node.children)
            text += '}\n'
        }
    }
    walk(file.head)
    walk(file.template)
    if (subjects > 0) text += ROWS_OF_DECLARATION
    text += POSITION_DECLARATIONS
    // 34.3 — BOTH BLOCKS, and the reason is the SERVER. `<script module>` is request-local there
    // (34.2), so the emitted component carries its body as well as the `<script>`'s — an `await`
    // at the top of either stands in an ordinary function and the module does not parse. In a
    // browser that same block IS module scope, where the line is legal, and a source that compiles
    // on one side and not the other is the one thing this seam may not produce.
    refuseTopLevelAwait(file.modules.join('\n'), '<script module>')
    refuseTopLevelAwait(scriptsText, '<script>')
    return {
        text,
        modules,
        scripts,
        slots,
        keys,
        tags,
        setups,
        origins,
    }
}

/**
 * What an attribute's value is opened with, which types it by the position it stands in.
 *
 * WHAT AN ATTRIBUTE'S POSITION TYPES ITS VALUE AS. A listener on an element is handed that
 * element's event, so a handler's parameter has the type the browser gives it rather than an
 * implicit `any`; a `bind:` operand, and an attribute on a component whose tag is no name a call
 * can spell (`invocation` has the rest), are typed by nothing the shadow can see, and say so with
 * `any` rather than with an error the author did not make. A `bind:` operand has a name of its own
 * so `propsReads` can tell a prop handed on as one.
 */
function openerOf(tag: string, lowerName: string): string {
    if (lowerName.startsWith('bind:')) return `${BIND}(`
    if (isComponentTag(tag)) return `${ANY}(`
    if (isEventName(lowerName))
        return `${ON}(${JSON.stringify(lowerName.slice(2))}, `
    return '('
}

const PROP = '__prop'
const ON = '__on'
const ANY = '__any'
const BIND = '__bind'
const BOUND = '__bound'

/** 33.6 — the type a written prop's cell is checked as, which is the framework's own. */
const REACTIVE = `import(${JSON.stringify(
    new URL('../shared/reactive/Reactive.ts', import.meta.url).pathname,
)}).Reactive`

/** 23.9 — the params a page's own route promises, which the framework spells. */
const ROUTE_PARAMS = `import(${JSON.stringify(
    new URL('../shared/url.ts', import.meta.url).pathname,
)}).RouteParams`

/**
 * Ambient declarations of the helpers the shadow and the checked program call.
 *
 * The names the shadow and the checked program (`checkedShadow`) spell and no author does, declared
 * after everything so no offset above moves, and ambient so nothing is emitted. `export {}` makes
 * every shadow a module: a shadow read as a script puts its names in the global scope, where every
 * other file in the project would find them.
 */
const POSITION_DECLARATIONS = `
declare function ${ON}<Name extends string>(name: Name, handler: ((event: Name extends keyof HTMLElementEventMap ? HTMLElementEventMap[Name] : Event) => unknown) | null | undefined | false): void
declare function ${ANY}(value: any): void
declare function ${PROP}<Value>(value: Value): Value
declare function ${BIND}(value: any): void
declare function ${BOUND}<Value>(value: ${REACTIVE}<Value, any, any, any>): Value
declare function ${BOUND}<Value>(value: { get(): Value; set(value: Value): unknown }): Value
declare function __propCell<Value>(read: () => Value): () => ${REACTIVE}<Value>
declare function __raw(value: unknown): unknown
declare function __writePath<Root>(root: Root, path: readonly PropertyKey[], value: unknown): Root
declare type __RouteParams<Pattern extends string, Kind extends string> = Kind extends 'layout' ? ${ROUTE_PARAMS}<Pattern> & { [name: string]: string | string[] | undefined } : ${ROUTE_PARAMS}<Pattern>
declare function __accessors<Record, Written extends keyof Record = never, Defaulted extends keyof Record = never>(record: Record, written?: readonly Written[], defaulted?: readonly Defaulted[]): { [Key in Exclude<keyof Record, Defaulted>]-?: Key extends Written ? () => ${REACTIVE}<Record[Key]> : () => Record[Key] } & { [Key in Defaulted]?: Key extends Written ? () => ${REACTIVE}<Exclude<Record[Key], undefined>> : () => Exclude<Record[Key], undefined> }
export {}
`

const AWAIT = 'await'

/** The prefix of the `const` a `{#for}`'s subject is held in, numbered per block. */
export const SUBJECT = '__subject'
const ROWS_OF = '__rowsOf'
/**
 * Ambient declaration of the helper that types a row's item from its subject.
 *
 * What a row's item is, read off the subject as `listOf` iterates it: what a `Reactive` read by
 * name hands back (31.1 lowers `rows` to `rows()`), or the subject itself. THE CALL IS THE FIRST
 * OVERLOAD because a `Reactive` is ALSO an `AsyncIterable` of its productions (2.7), and inferred
 * over one union the item came out as the row OR the whole list. Declared AFTER everything, so no
 * offset above it moves, and ambient, so there is nothing to emit. Where inference fails the item
 * is `unknown`, and a member of that is unprovable — the safe side.
 */
const ROWS_OF_DECLARATION = `
declare function ${ROWS_OF}<T>(subject: () => Iterable<T> | null | undefined): T[]
declare function ${ROWS_OF}<T>(subject: Iterable<T> | AsyncIterable<T> | null | undefined): T[]
`

/**
 * Throws where `source` awaits at its top level.
 *
 * 34.3 — A SCRIPT BLOCK MAY NOT AWAIT AT ITS TOP LEVEL. Component setup is a function body on both
 * sides, so nothing in the render is held and every value a page reads is a hole the document is
 * written around (41.4, 32.24). Refused rather than emitted: the module bun then fails to build
 * names neither the page nor the line.
 *
 * DEPTH IS WHAT "TOP LEVEL" MEANS, and it is the whole of what this rule costs. An `await` inside a
 * handler, a `reactive` body or any other function in the block is that function's own and is
 * untouched — which is where 31.3's `await` operand still does its work.
 */
function refuseTopLevelAwait(source: string, block: string): void {
    if (!source.includes(AWAIT)) return
    let depth = 0
    for (const token of tokenise(source)) {
        const text = token.text
        if (text === '{' || text === '(' || text === '[') depth += 1
        else if (text === '}' || text === ')' || text === ']') depth -= 1
        else if (depth === 0 && text === AWAIT)
            throw new Error(
                `abide: a ${block} cannot await at its top level — setup is a function body, and nothing holds the render. Await inside a handler or a reactive body, or read the value and let the position fill. RULEBOOK 34.3.`,
            )
    }
}
