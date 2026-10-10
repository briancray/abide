import { SyntaxKind } from 'typescript/unstable/ast'
import { isEventName } from '#shared/isEventName.ts'
import { isComponentTag, propKeyOf } from './classifyTemplate.ts'
import { isNamedAlone } from './isNamedAlone.ts'
import {
    type Position,
    type PositionKind,
    PositionTable,
} from './PositionTable.ts'
import type { AbideFile } from './parseAbide.ts'
import type {
    Body,
    Branch,
    ElementNode,
    InlineComponent,
    Setup,
    TemplateNode,
} from './TemplateNode.ts'
import { tokenize } from './tokenize.ts'

export type Span = { start: number; end: number }

/**
 * A `.abide` file as one TypeScript program, with where each piece of it came from.
 *
 * Its `<script module>`, its `<script>`, and every expression its template holds, each where the scopes it stands in are. The checker reads this
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
    /** Every template position, ascending, each with its kind — what the checker's tree is asked. */
    positions: PositionTable
    /**
     * Per holder — an expression node, an attribute, an `{#if}` arm, a `{#for}` block, a setup, an
     * inline component's head — the position of the expression it holds. A `bind:` operand's kind
     * says it holds the `Reactive` rather than reading it (31.3, `Lowering.reference`).
     */
    slots: Map<object, Position>
    /**
     * Per `{#for}` block, the position of its `by` key, which stands inside the loop and sees the row.
     */
    keys: Map<object, Position>
    /**
     * 32.34 — per invocation, the position of its tag: a read there is a component chosen by a value.
     */
    tags: Map<object, Position>
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
    // 34.13 — scaffolding ahead of every block, so each one and the template are in their scope.
    let text =
        file.generics === undefined ? '' : genericDeclarations(file.generics)
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
    const positions: Position[] = []
    const slots = new Map<object, Position>()
    const keys = new Map<object, Position>()
    const tags = new Map<object, Position>()
    let inlineProps = false
    // Spans are written in ascending order, so the table is sorted as it is pushed.
    const position = (span: Span, kind: PositionKind): Position => {
        const found = { start: span.start, end: span.end, kind }
        positions.push(found)
        return found
    }

    // `open` is what the statement starts with: a bare parenthesis, or a call that hands the value
    // the type its position gives it (`openerOf`).
    const expression = (
        source: string,
        origin: number | undefined,
        kind: PositionKind,
        open = '(',
    ): Position => {
        text += `;${open}`
        const span = position(copied(source, origin), kind)
        text += ')\n'
        return span
    }

    let subjects = 0

    // 14.8 — A BRANCH-LOCAL `<script>` IS STATEMENTS AT THE HEAD OF ITS BODY, inside the loop or the
    // braces that scope it, so its names are the body's and the checker reads it as the body does.
    const setup = (owned: Setup | null): void => {
        if (owned === null) return
        slots.set(
            owned,
            position(
                copied(owned.text, file.origins.holders.get(owned)),
                'setup',
            ),
        )
        text += '\n'
        refuseTopLevelAwait(owned.text, 'branch-local <script>')
    }

    // 32.17 — A COMPONENT TAG IS A CALL, AND IT IS PROJECTED AS ONE: the name it invokes, handed the
    // record the build hands it (`invocationProps`), so the checker holds each value to the prop the
    // child declares (33.4), reports a name nobody imported, and answers a hover or a jump on the
    // tag with the import's (38.40). Spreads first and explicit keys after, which is the order 33.12
    // resolves them in.
    const invocation = (node: ElementNode): void => {
        // 32.36 — CALLED OPTIONALLY, so a value that may be absent is checked as one that may
        // render nothing; a tag that is always a component reads the same either way.
        //
        // 32.34 — AND THE STATEMENT IS THE PARENTHESES, NOT THE CALL. A call standing as a statement
        // is one the checker asks whether it ASSERTS, which it answers from the callee's type while
        // it is still walking the flow — so a callee whose type is `ReturnType<typeof Shown>`
        // reached back into `Shown`'s own initializer and reported it circular (TS2502).
        text += ';(('
        tags.set(
            node,
            position(copied(node.tag, file.origins.holders.get(node)), 'tag'),
        )
        text += ')?.({\n'
        // 32.6 — a `bind:` hands over the caller's `Reactive` or a `{ get, set }` pair, held to
        // the prop as the value it holds, and marked for `propsReads` as a name the child hands on.
        const prop = (attribute: (typeof node.attributes)[number]): void => {
            const operand = attribute.lowerName.startsWith('bind:')
            text += operand ? `${BOUND}(` : `${PROP}(`
            slots.set(
                attribute,
                position(
                    copied(
                        attribute.value,
                        file.origins.holders.get(attribute),
                    ),
                    operand ? 'componentBind' : 'prop',
                ),
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
        // 32.50, 32.54 — each component passed between the tags is the prop of its name, held to
        // the type the child declares for it and found at the component's own name.
        for (const passed of node.passed) {
            place(passed.at, 0)
            text += `${JSON.stringify(passed.name)}: `
            copied(passed.name, passed.at)
            text += ',\n'
        }
        text += '}))\n'
        for (const attribute of refused)
            slots.set(
                attribute,
                expression(
                    attribute.value,
                    file.origins.holders.get(attribute),
                    'untyped',
                    `${ANY}(`,
                ),
            )
    }

    // 32.40, 32.42 — AN INLINE COMPONENT IS A FUNCTION DECLARED WHERE IT IS WRITTEN, so it sees
    // every name in scope there, as the emitted one does, and a tag invoking it is the call on it
    // that `invocation` already writes. It takes the record its pattern types, and binds its pattern
    // with a `props` call of its own.
    const component = (declared: InlineComponent): void => {
        text += 'function '
        copied(declared.name, declared.at)
        text += `(${RECORD}: `
        if (declared.pattern === '') text += NO_PROPS
        else if (declared.type === '') text += 'Record<string, unknown>'
        else copied(declared.type, declared.typeAt)
        text += '): void {\n'
        if (declared.pattern !== '') {
            inlineProps = true
            const start = text.length
            text += 'const '
            copied(declared.pattern, declared.patternAt)
            text += ` = ${INLINE_PROPS}<typeof ${RECORD}>()`
            slots.set(declared, position({ start, end: text.length }, 'head'))
            text += '\n'
        }
        inBody(declared)
        text += '}\n'
    }
    // 32.43 — a body's components stand at its head, so each is in scope throughout it.
    const declare = (components: readonly InlineComponent[]): void => {
        for (const declared of components) component(declared)
    }
    // A body inside braces of its own: its setup (14.8), its components, then its nodes.
    const inBody = (owned: Body): void => {
        setup(owned.setup)
        declare(owned.components)
        walk(owned.children)
    }
    // What an element holds has no braces of its own, and is given some where it declares a
    // component (32.43).
    const body = (
        nodes: TemplateNode[],
        components: readonly InlineComponent[],
    ): void => {
        if (components.length === 0) {
            walk(nodes)
            return
        }
        text += '{\n'
        declare(components)
        walk(nodes)
        text += '}\n'
    }

    const walk = (nodes: TemplateNode[]): void => {
        for (const node of nodes) {
            if (node.kind === 'text') continue
            if (node.kind === 'expression') {
                slots.set(
                    node,
                    expression(
                        node.source,
                        file.origins.holders.get(node),
                        'slot',
                    ),
                )
                continue
            }
            if (node.kind === 'element') {
                // 32.51 — what an invocation is passed is in scope at the call and nowhere after.
                if (node.passed.length > 0) {
                    text += '{\n'
                    declare(node.passed)
                }
                if (isComponentTag(node.tag) && isNamedAlone(node.tag))
                    invocation(node)
                else
                    for (const attribute of node.attributes) {
                        if (!attribute.expression) continue
                        const [kind, open] = attribute.lowerName.startsWith(
                            'bind:',
                        )
                            ? (['elementBind', `${BIND}(`] as const)
                            : openerOf(node.tag, attribute.lowerName)
                        slots.set(
                            attribute,
                            expression(
                                attribute.value,
                                file.origins.holders.get(attribute),
                                kind,
                                open,
                            ),
                        )
                    }
                if (node.passed.length > 0) text += '}\n'
                body(node.children, node.components)
                continue
            }
            // 32.16 — the catch arm binds the failure, and the checker has to see the name.
            if (node.block === 'try') {
                const [tried, caught] = node.branches as [Branch, Branch]
                text += '{\n'
                inBody(tried)
                text += `}\n{ const ${node.error === '' ? '__failure' : node.error}: any = undefined\n`
                inBody(caught)
                text += '}\n'
                continue
            }
            // AN `{#if}` IS PROJECTED AS THE `if` IT IS, so an arm is checked under what its condition
            // established: `{#if contact}{contact.name}` is a `Contact` there, a discriminant
            // narrows its union, and `{:else}` has the rest. Written as a bare `(subject)` statement
            // beside its arms, every arm was checked as if the condition had never been asked.
            //
            // The braces are also what scope an arm's branch-local `<script>` (14.8).
            if (node.block === 'if') {
                let first = true
                for (const branch of node.branches) {
                    if (branch.subject === '') text += ' else {\n'
                    else {
                        text += first ? ';if (' : ' else if ('
                        slots.set(
                            branch,
                            position(
                                copied(
                                    branch.subject,
                                    file.origins.holders.get(branch),
                                ),
                                'condition',
                            ),
                        )
                        text += ') {\n'
                    }
                    first = false
                    inBody(branch)
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
                position(
                    copied(node.subject, file.origins.holders.get(node)),
                    'subject',
                ),
            )
            text += ')\n'
            text += `for (const ${node.item} of ${ROWS_OF}(${subject})) {\n`
            if (node.index !== '') text += `const ${node.index} = 0\n`
            // `inBody` but for the key, which stands after the row's setup and before its nodes.
            setup(node.setup)
            declare(node.components)
            if (node.key !== '')
                keys.set(
                    node,
                    expression(node.key, file.origins.keys.get(node), 'key'),
                )
            walk(node.children)
            text += '}\n'
        }
    }
    declare(file.components)
    walk(file.head)
    walk(file.template)
    if (subjects > 0) text += ROWS_OF_DECLARATION
    if (inlineProps) text += INLINE_PROPS_IMPORT
    text += POSITION_DECLARATIONS
    // 34.3 — BOTH BLOCKS. A `<script>` is a function body on both sides, where an `await` at its top
    // does not parse; a `<script module>` is module scope, where it would, and holds the import of
    // every file that reaches it until it settles — the render waiting on it in all but name.
    refuseTopLevelAwait(file.modules.join('\n'), '<script module>')
    refuseTopLevelAwait(scriptsText, '<script>')
    refuseInstanceExport(scriptsText)
    return {
        text,
        modules,
        scripts,
        positions: new PositionTable(positions),
        slots,
        keys,
        tags,
        origins,
    }
}

/**
 * What an attribute's value is opened with, which types it by the position it stands in.
 *
 * A listener on an element is handed that
 * element's event, so a handler's parameter has the type the browser gives it rather than an
 * implicit `any`; an attribute on a component whose tag is no name a call can spell (`invocation`
 * has the rest) is typed by nothing the shadow can see, and says so with `any` rather than with an
 * error the author did not make. A `bind:` operand is not asked about here: the caller opens it
 * with `BIND`, which types it as `any` too.
 */
function openerOf(
    tag: string,
    lowerName: string,
): readonly [PositionKind, string] {
    if (isComponentTag(tag)) return ['untyped', `${ANY}(`]
    if (isEventName(lowerName))
        return ['listener', `${ON}(${JSON.stringify(lowerName.slice(2))}, `]
    return ['attribute', '(']
}

const PROP = '__prop'
// What an inline component's function names the record it is called with, and abide's `props` as
// its head calls it (32.40) — bound here, since the author imports `props` only where they call it.
const RECORD = '__record'
export const INLINE_PROPS = '__inlineProps'
const INLINE_PROPS_IMPORT = `
import { props as ${INLINE_PROPS} } from ${JSON.stringify(
    Bun.fileURLToPath(new URL('../shared/props.ts', import.meta.url)),
)}
`
/**
 * The props type of a component with no `props` call.
 *
 * 33.2 — a component with no `props` call takes no prop of its own; 33.16 — `children` is the one
 * key every component takes, and the tag's body passes it rather than an attribute.
 */
export const NO_PROPS = '{ [key: string]: never }'
const ON = '__on'
const ANY = '__any'
/** 31.3 — what a `bind:` operand is wrapped in on an element and on a component. */
const BIND = '__bind'
const BOUND = '__bound'

/** 33.6 — the type a written prop's cell is checked as, which is the framework's own. */
const REACTIVE = `import(${JSON.stringify(
    Bun.fileURLToPath(
        new URL('../shared/reactive/Reactive.ts', import.meta.url),
    ),
)}).Reactive`

/** 23.9 — the params a page's own route promises, which the framework spells. */
const ROUTE_PARAMS = `import(${JSON.stringify(
    Bun.fileURLToPath(new URL('../shared/url.ts', import.meta.url)),
)}).RouteParams`

/**
 * Ambient declarations of the helpers the shadow and the checked program call.
 *
 * Names the shadow and `checkedShadow` spell and no author does, declared after everything so no offset above moves, and ambient so nothing is emitted. `export {}` makes
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
declare function __restValues<Accessors>(record: Accessors): { [Key in keyof Accessors]: NonNullable<Accessors[Key]> extends () => infer Value ? Value : never }
declare function __propCell<Value>(read: () => Value): () => ${REACTIVE}<Value>
declare function __raw(value: unknown): unknown
declare function __writePath<Root>(root: Root, path: readonly PropertyKey[], value: unknown): Root
declare type __RouteParams<Pattern extends string, Kind extends string> = Kind extends 'layout' ? ${ROUTE_PARAMS}<Pattern> & { [name: string]: string | string[] | undefined } : ${ROUTE_PARAMS}<Pattern>
declare function __accessors<Record, Written extends keyof Record = never, Defaulted extends keyof Record = never>(record: Record, written?: readonly Written[], defaulted?: readonly Defaulted[]): { [Key in keyof Record as Key extends Defaulted ? never : Key]-?: Key extends Written ? () => ${REACTIVE}<Record[Key]> : () => Record[Key] } & { [Key in Defaulted]?: Key extends Written ? () => ${REACTIVE}<Exclude<Record[Key], undefined>> : () => Exclude<Record[Key], undefined> }
export {}
`

const AWAIT = 'await'
const EXPORT = 'export'

/** The prefix of the `const` a `{#for}`'s subject is held in, numbered per block. */
const SUBJECT = '__subject'
const ROWS_OF = '__rowsOf'
/**
 * Ambient declaration of the helper that types a row's item from its subject.
 *
 * The item is read off the subject as `listOf` iterates it: what a `Reactive` read by
 * name hands back (31.1 lowers `rows` to `rows()`), or the subject itself. THE CALL IS THE FIRST
 * OVERLOAD because a `Reactive` is ALSO an `AsyncIterable` of its productions (2.5), and inferred
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
 * written around (41.4, 32.23). Refused rather than emitted: the module bun then fails to build
 * names neither the page nor the line.
 *
 * DEPTH IS WHAT "TOP LEVEL" MEANS, and it is the whole of what this rule costs. An `await` inside a
 * handler, a `reactive` body or any other function in the block is that function's own and is
 * untouched — which is where 31.3's `await` operand still does its work.
 */
function refuseTopLevelAwait(source: string, block: string): void {
    if (!source.includes(AWAIT)) return
    let depth = 0
    for (const token of tokenize(source)) {
        const text = token.text
        if (text === '{' || text === '(' || text === '[') depth += 1
        else if (text === '}' || text === ')' || text === ']') depth -= 1
        else if (depth === 0 && text === AWAIT)
            throw new Error(
                `abide: a ${block} cannot await at its top level — setup is a function body, and nothing holds the render. Await inside a handler or a reactive body, or read the value and let the position fill. RULEBOOK 34.3.`,
            )
    }
}

/**
 * Throws where a `<script>` exports.
 *
 * 34.18 — AN EXPORT IS THE MODULE'S, and a `<script>` runs once per instance: there is no one
 * instance an importer could be reading from. Refused rather than emitted, as 34.3's `await` is —
 * the block is a function body on both sides, and the bundler's own error names neither the page
 * nor the fix.
 */
function refuseInstanceExport(source: string): void {
    if (!source.includes(EXPORT)) return
    let depth = 0
    let previous = ''
    for (const token of tokenize(source)) {
        const text = token.text
        if (text === '{' || text === '(' || text === '[') depth += 1
        else if (text === '}' || text === ')' || text === ']') depth -= 1
        else if (depth === 0 && text === EXPORT && previous !== '.')
            throw new Error(
                "abide: a <script> cannot export — it runs once per instance, and an export is the module's. Move the declaration to <script module>. RULEBOOK 34.18.",
            )
        previous = text
    }
}

/**
 * 34.13 — each type parameter a component declares, as a type its body cannot see inside.
 *
 * THE BODY IS CHECKED AS A GENERIC FUNCTION'S BODY WOULD BE: for every `T` at once, so a parameter
 * is an OPAQUE type — its constraint, and a brand nothing else carries. The blocks stand at the
 * module's top level rather than in a function a type parameter could be declared on, because
 * an `import` cannot stand inside one.
 */
function genericDeclarations(generics: string): string {
    let declarations = ''
    for (const { name, constraint } of typeParametersOf(generics))
        declarations += `declare const __generic_${name}: unique symbol\ntype ${name} = (${constraint}) & { readonly [__generic_${name}]: true }\n`
    return declarations
}

/** The names and constraints a type parameter list spells, `unknown` where one has none. */
function typeParametersOf(
    generics: string,
): { name: string; constraint: string }[] {
    const found: { name: string; constraint: string }[] = []
    let depth = 0
    let name: string | undefined
    let constraintFrom = -1
    let constraintTo = -1
    const close = (end: number): void => {
        if (name !== undefined)
            found.push({
                name,
                constraint:
                    constraintFrom === -1
                        ? 'unknown'
                        : generics.slice(
                              constraintFrom,
                              constraintTo === -1 ? end : constraintTo,
                          ),
            })
        name = undefined
        constraintFrom = -1
        constraintTo = -1
    }
    for (const token of tokenize(generics)) {
        const kind = token.kind
        if (
            kind === SyntaxKind.LessThanToken ||
            kind === SyntaxKind.OpenParenToken ||
            kind === SyntaxKind.OpenBracketToken ||
            kind === SyntaxKind.OpenBraceToken
        )
            depth += 1
        else if (
            kind === SyntaxKind.GreaterThanToken ||
            kind === SyntaxKind.CloseParenToken ||
            kind === SyntaxKind.CloseBracketToken ||
            kind === SyntaxKind.CloseBraceToken
        )
            depth -= 1
        if (depth !== 0) continue
        if (kind === SyntaxKind.CommaToken) close(token.start)
        else if (name === undefined && kind === SyntaxKind.Identifier)
            name = token.text
        else if (kind === SyntaxKind.ExtendsKeyword && constraintFrom === -1)
            constraintFrom = token.end
        else if (kind === SyntaxKind.EqualsToken && constraintTo === -1)
            constraintTo = token.start
    }
    close(generics.length)
    return found
}
