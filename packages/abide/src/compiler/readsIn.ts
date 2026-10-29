import type { Node, SourceFile, TypeNode } from 'typescript/unstable/ast'
import { SyntaxKind } from 'typescript/unstable/ast'
import {
    isArrayBindingPattern,
    isArrayLiteralExpression,
    isArrowFunction,
    isBinaryExpression,
    isCallExpression,
    isClassDeclaration,
    isEnumDeclaration,
    isExpressionStatement,
    isForOfStatement,
    isFunctionDeclaration,
    isFunctionExpression,
    isIdentifier,
    isImportDeclaration,
    isMethodDeclaration,
    isNamedImports,
    isNewExpression,
    isObjectBindingPattern,
    isParenthesizedExpression,
    isPropertyAccessExpression,
    isReturnStatement,
    isVariableDeclaration,
    isVariableDeclarationList,
    isVariableStatement,
} from 'typescript/unstable/ast/is'
import {
    type Symbol as CheckedSymbol,
    type Checker,
    SignatureKind,
    SymbolFlags,
    type Type,
    TypeFlags,
} from 'typescript/unstable/async'
import { aliasedSymbol } from './aliasedSymbol.ts'
import { CheckerAnswer } from './CheckerAnswer.ts'
import {
    classifyPropRead,
    classifyRead,
    expressionFacts,
    newRead,
    provePosition,
    type Read,
    TRANSPARENT,
} from './classifyRead.ts'
import type { Finding } from './Finding.ts'
import {
    holdsReactive,
    type Position,
    type PositionKind,
    type PositionTable,
} from './PositionTable.ts'
import type { AbideFile } from './parseAbide.ts'
import { INLINE_PROPS, type Span } from './projectShadow.ts'
import { REACTIVE_MEMBERS } from './REACTIVE_MEMBERS.ts'
import { optionNamed, reactiveOptions } from './reactiveOptions.ts'
import {
    type Abide,
    boundInitializer,
    isReactiveType,
    unionMembers,
    valueTypeOf,
} from './reactiveTypes.ts'
import { sharedModuleWrites } from './sharedModuleWrites.ts'
import { trackingWarnings } from './trackingWarnings.ts'

/** Where in a `.abide`'s shadow each kind of question is asked (`projectShadow`). */
export type ShadowSpans = {
    /** Where the shadow's scripts end and its template begins. */
    scriptsEnd: number
    /** The `<script module>`, `<script server>` and `<script>` bodies, in the shadow. */
    modules: Span
    servers: Span
    scripts: Span
    positions: PositionTable
    /** 32.67 — where each `{#for}` row's item binding starts. */
    items: Set<number>
}

const SETUP: ReadonlySet<PositionKind> = new Set(['setup'])
const HEAD: ReadonlySet<PositionKind> = new Set(['head'])
/**
 * 14.2 — the positions whose value the template converts to a string or tests, which a proof can
 * write once (`proveSlots`). A key, a prop, a tag and a listener are never asked `isLive`.
 */
const PROVABLE: ReadonlySet<PositionKind> = new Set([
    'slot',
    'attribute',
    'condition',
    'subject',
])
/**
 * 32.57 — every position a template EXPRESSION stands in, whose `await` is refused
 * (`expressionFacts`). A setup and a head are `<script>` statements, which 34.3 governs, and a tag
 * names a component rather than computing a value.
 */
const TEMPLATE_EXPRESSIONS: ReadonlySet<PositionKind> = new Set([
    ...PROVABLE,
    'key',
    'listener',
    'prop',
    'elementBind',
    'componentBind',
    'untyped',
])
/**
 * 32.25 — the positions whose value reaches markup, where a bare `raw(…)` is the framework's. In a
 * listener, a `bind:` operand or a key the value never renders, and `raw` is what the file binds.
 */
const RAW_LOWERED: ReadonlySet<PositionKind> = new Set([...PROVABLE, 'prop'])

/**
 * The classified reactive reads in one `.abide`'s shadow, and the warnings they earn.
 *
 * 31.3 — THE CHECKER'S OWN TREE ANSWERS BOTH QUESTIONS. Which names the file binds is its top-level
 * `const`/`let`/`var` statements and its imports — an inner block's name is not the page's — and
 * which occurrences reach one is the references to that symbol. A parameter, a row's item, a
 * key, a member, a label and a class field of the same spelling are other symbols, and are
 * absent. What each reference DOES — a read, a write, an update, a shorthand — is read off its
 * parents by `classifyRead`, so no token walk re-derives the grammar.
 *
 * Asked of one snapshot (`TypeSession.readsFor`), and every offset — a read's and a warning's — is
 * the shadow's; the session places them in the `.abide`.
 */
export async function readsIn(
    checker: Checker,
    abide: Abide,
    sourceFile: SourceFile,
    shadowPath: string,
    spans: ShadowSpans,
    file: AbideFile,
    /** Where each name the lowered program proved a `Reactive` starts (`bindingsOfReads`). */
    held: ReadonlySet<number>,
): Promise<{ answer: CheckerAnswer; warnings: Finding[]; suspects: number[] }> {
    // A destructuring pattern binds names this does not see, and that is 31.12's case.
    const names: Node[] = []
    const spelled = new Set<string>()
    const bind = (name: Node): void => {
        if (!isIdentifier(name) || spelled.has(name.text)) return
        spelled.add(name.text)
        names.push(name)
    }
    for (const statement of sourceFile.statements) {
        if (statement.getStart() >= spans.scriptsEnd) break
        if (isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations)
                bind(declaration.name)
            continue
        }
        // 31.1 — AN IMPORT BINDS A NAME AS A DECLARATION DOES, and the clause does not
        // tell the two apart: `onboarding` from `#shared/conversations` is read and
        // written by name like the page's own. A NAMESPACE is not one of them — the
        // name is bound to the module, and `ns.value` is a member of it.
        if (!isImportDeclaration(statement)) continue
        const clause = statement.importClause
        if (
            clause === undefined ||
            clause.phaseModifier === SyntaxKind.TypeKeyword
        )
            continue
        if (clause.name !== undefined) bind(clause.name)
        const named = clause.namedBindings
        if (named !== undefined && isNamedImports(named))
            for (const element of named.elements)
                if (!element.isTypeOnly) bind(element.name)
    }
    // 31.1 REACHES A BRANCH-LOCAL `<script>` (14.8), which stands inside the arm's braces
    // or the row's loop rather than at the top — and a name there is spelled apart from
    // the page's, since two arms may each declare their own `inner`.
    const topLevel = names.length
    // The script's own statements, as the top-level walk takes the page's: a declaration inside
    // one of its functions is not a name the body reads.
    for (const { node } of spans.positions.nodesIn(sourceFile, SETUP))
        if (isVariableStatement(node))
            for (const declaration of node.declarationList.declarations)
                if (isIdentifier(declaration.name)) names.push(declaration.name)
    refuseDeclared(sourceFile.statements, spans.scriptsEnd, file)
    const reads: Read[] = []
    // 33's pass runs whatever 31.3's found: a `props` pattern binds no name the walk
    // above collects — `const { amount } = props()` declares a PATTERN — so a file
    // whose only declaration is one would have returned with its props unread.
    const props = propsReads(
        checker,
        abide,
        sourceFile,
        shadowPath,
        spans.scriptsEnd,
        spans.positions,
        reads,
    )
    // Awaited after the round trips below, so a 33.14 refusal would reject with nothing
    // listening and be reported unhandled; `await props` still throws it.
    props.catch(() => {})
    const params = routeReads(checker, abide, sourceFile, reads)
    const rows = rowReads(checker, sourceFile, shadowPath, spans, reads)
    const configs = configReads(
        checker,
        abide,
        sourceFile,
        spans.servers,
        reads,
    )
    // No name is no round trip to ask about none.
    const symbols =
        names.length === 0 ? [] : await checker.getSymbolAtLocation(names)
    const reactive = await Promise.all(
        symbols.map(async (symbol) =>
            symbol !== undefined &&
            (await isReactiveSymbol(checker, abide, symbol))
                ? symbol
                : undefined,
        ),
    )
    await dropValueHolders(checker, names, reactive)
    for (let at = 0; at < names.length; at += 1)
        if (
            reactive[at] === undefined &&
            held.has((names[at] as Node).getStart())
        )
            reactive[at] = symbols[at]
    // 32.32 — A VALUE WHOSE `reactive(…)` DECLARES `by` keys a `{#for}` over it,
    // wherever the value is declared.
    const byValue = await Promise.all(
        reactive.map(async (symbol) => {
            if (symbol === undefined) return false
            const options = reactiveOptions(
                await boundInitializer(checker, symbol),
            )
            return (
                options !== undefined &&
                optionNamed(options, 'by') !== undefined
            )
        }),
    )
    const nodes = await Promise.all(
        reactive.map(async (symbol) => {
            if (symbol === undefined) return []
            const references = await checker.getReferencesToSymbolInFile(
                shadowPath,
                symbol,
            )
            return Promise.all(
                references.map((reference) => reference.resolve()),
            )
        }),
    )
    const holding: Promise<void>[] = []
    const located: { node: Node; read: Read }[] = []
    for (let index = 0; index < nodes.length; index += 1)
        for (const node of nodes[index] as (Node | undefined)[]) {
            if (node === undefined) continue
            const read = classifyRead(node)
            if (read === undefined) continue
            read.byValue = byValue[index] as boolean
            read.local = index >= topLevel
            reads.push(read)
            located.push({ node, read })
            if (read.shape === 'value')
                holding.push(
                    declaredType(checker, node).then(async (type) => {
                        if (
                            type !== undefined &&
                            (await isReactiveType(checker, abide, type, true))
                        )
                            read.shape = 'asWritten'
                    }),
                )
        }
    await Promise.all(holding)
    await props
    await params
    await rows
    await configs
    const statics = new Set<number>()
    const expressions = spans.positions.nodesIn(
        sourceFile,
        TEMPLATE_EXPRESSIONS,
    )
    const rawCallees: Node[] = []
    for (const { position, node } of expressions)
        expressionFacts(
            node,
            RAW_LOWERED.has(position.kind) ? rawCallees : undefined,
        )
    // A `Reactive` the page named `raw` is a read, and the read's rewrite is the answer.
    if (rawCallees.length > 0) {
        const named = new Set<number>()
        for (const one of reads) named.add(one.start)
        for (const callee of rawCallees)
            if (!named.has(callee.getStart()))
                reads.push(newRead(callee.getStart(), callee.end, 'raw'))
    }
    await proveSlots(checker, expressions, reads, statics)
    reads.sort(byPosition)
    const warnings = await warningsFor(checker, located, spans.positions)
    // 34.18.
    for (const warning of await sharedModuleWrites(
        checker,
        shadowPath,
        names.slice(0, topLevel),
        symbols,
        reactive,
        spans.modules,
        spans.scripts,
    ))
        warnings.push(warning)
    const answer = new CheckerAnswer(reads, statics)
    return {
        answer,
        warnings,
        suspects: await bindingsOfReads(
            checker,
            abide,
            names,
            reactive,
            answer,
        ),
    }
}

/**
 * Where each binding starts whose type the projection cannot vouch for, for the lowered program to
 * answer (`TypeSession.classify`).
 *
 * 31.1 — A BINDING TYPED FROM A READ IS TYPED FROM THE `Reactive` IN THE PROJECTION, and the read is
 * of its value. `reactive(route.url.pathname)` asks a `Reactive<URL>` for a `pathname` it does not
 * declare; the argument is the error type, which `reactive`'s overloads resolve to a `Keyed`, and
 * the binding then lowered as no `Reactive` at all — `bookId = 'y'` rebinding the name and nothing
 * waking. Lowered, the argument is `route.url().pathname` and the binding a `Reactive<string>`.
 *
 * ONLY A CALL THAT CAN HAND BACK A `Reactive` IS ASKED: an un-annotated binding, not one already,
 * initialized by a call holding a read, to a callee one of whose signatures returns a `Reactive`.
 * Anything else is a value however its reads are typed, and asking would cost every page that
 * computes from one a second snapshot.
 */
async function bindingsOfReads(
    checker: Checker,
    abide: Abide,
    names: readonly Node[],
    reactive: readonly (CheckedSymbol | undefined)[],
    answer: CheckerAnswer,
): Promise<number[]> {
    const suspects: number[] = []
    const asked: Promise<void>[] = []
    for (let at = 0; at < names.length; at += 1) {
        const name = names[at] as Node
        const declaration = name.parent
        if (
            reactive[at] !== undefined ||
            !isVariableDeclaration(declaration) ||
            declaration.type !== undefined ||
            declaration.initializer === undefined
        )
            continue
        let call: Node = declaration.initializer
        while (TRANSPARENT.has(call.kind))
            call = (call as unknown as { expression: Node }).expression
        if (
            !isCallExpression(call) ||
            !answer.holdsRead({ start: call.getStart(), end: call.end })
        )
            continue
        const callee = call.expression
        asked.push(
            (async () => {
                const type = await checker.getTypeAtLocation(callee)
                if (type === undefined) return
                for (const signature of await checker.getSignaturesOfType(
                    type,
                    SignatureKind.Call,
                )) {
                    const returned =
                        await checker.getReturnTypeOfSignature(signature)
                    if (
                        returned !== undefined &&
                        (await isReactiveType(checker, abide, returned, false))
                    ) {
                        suspects.push(name.getStart())
                        return
                    }
                }
            })(),
        )
    }
    await Promise.all(asked)
    return suspects
}

/**
 * The tracking and type warnings a file's reactive reads earn.
 *
 * The syntax alone decides 14.14 to 14.16 (`trackingWarnings`);
 * 14.17 and 31.13 ask what a read hands back, which is the return of the `Reactive`'s call.
 */
async function warningsFor(
    checker: Checker,
    located: { node: Node; read: Read }[],
    positions: PositionTable,
): Promise<Finding[]> {
    const starts: { start: number; name: string }[] = []
    for (const { node, read } of located)
        if (READING.has(read.shape))
            starts.push({
                start: read.start,
                name: (node as { text?: string }).text ?? '',
            })
    const warnings: Finding[] = []
    const typed: Promise<void>[] = []
    for (const { node, read } of located) {
        const name = (node as { text?: string }).text ?? ''
        if (READING.has(read.shape))
            for (const warning of trackingWarnings(
                node,
                name,
                positions,
                starts,
            ))
                warnings.push(warning)
        const parent = node.parent
        const nullish =
            read.shape === 'value' &&
            isBinaryExpression(parent) &&
            parent.left === node &&
            parent.operatorToken.kind === SyntaxKind.QuestionQuestionToken
        const member =
            isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            isIdentifier(parent.name) &&
            REACTIVE_MEMBERS.has(parent.name.text)
                ? parent.name.text
                : undefined
        if (!nullish && member === undefined) continue
        typed.push(
            valueTypeOf(checker, node).then(async (value) => {
                if (value === undefined) return
                // 14.17 — the fallback of a read that is never nullish is never taken: an unlanded
                // read is a hole the position fills, not an `undefined` (2.2).
                if (nullish && !(await admitsNullish(value)))
                    warnings.push({
                        at: read.start,
                        message: `abide: \`${name} ?? …\` never takes its fallback — a read of \`${name}\` is not undefined while it loads, and its type says it is not undefined after. Ask \`${name}.ready()\` to tell the two apart. RULEBOOK 14.17.`,
                    })
                if (member === undefined) return
                // Per member, because a union's properties are only those every member shares, and
                // `undefined` shares none — so `HTMLVideoElement | undefined` would declare no `error`.
                for (const held of await unionMembers(value)) {
                    if ((held.flags & NULLISH) !== 0) continue
                    for (const property of await checker.getPropertiesOfType(
                        held,
                    ))
                        if (property.name === member) {
                            const dot = (
                                parent as { questionDotToken?: unknown }
                            ).questionDotToken
                                ? '?.'
                                : '.'
                            warnings.push({
                                at: read.start,
                                message: `abide: \`${name}${dot}${member}\` reaches the Reactive's own \`${member}\`, and the value it holds has one too. Write \`${name}()${dot}${member}\` for the value's. RULEBOOK 31.13.`,
                            })
                            return
                        }
                }
            }),
        )
    }
    await Promise.all(typed)
    warnings.sort((one, two) => one.at - two.at)
    return warnings
}

/** The shapes that are a read of the value, which is what tracking is about. */
const READING: ReadonlySet<Read['shape']> = new Set([
    'value',
    'call',
    'shorthand',
])

const NULLISH =
    TypeFlags.Null |
    TypeFlags.Undefined |
    TypeFlags.Void |
    TypeFlags.Any |
    TypeFlags.Unknown

async function admitsNullish(type: Type): Promise<boolean> {
    for (const member of await unionMembers(type))
        if ((member.flags & NULLISH) !== 0) return true
    return false
}

/**
 * The declared type of the position a read stands in: a parameter, an annotated binding or return.
 *
 * 31.3 — the three the clause names: a call's parameter, an annotated binding, an annotated
 * return. An array literal
 * passes its position through, because `watch([a, b], …)` is the parameter's own shape. Anything
 * else is `undefined` and stays a read.
 *
 * THE PARAMETER IS ASKED OF THE SIGNATURE'S TARGET, the generic declaration, and never of the
 * instantiated one: `structuredClone<T>(value: T)` INFERS `T` from this very argument, and an
 * instantiated signature would call the argument a `Reactive` because it already is one in the
 * shadow.
 */
async function declaredType(
    checker: Checker,
    node: Node,
): Promise<Type | undefined> {
    let top = node
    while (
        isArrayLiteralExpression(top.parent) ||
        isParenthesizedExpression(top.parent)
    )
        top = top.parent
    const parent = top.parent
    if (
        (isCallExpression(parent) || isNewExpression(parent)) &&
        parent.expression !== top
    ) {
        const index = parent.arguments?.indexOf(top as never) ?? -1
        if (index < 0) return undefined
        const resolved = await checker.getResolvedSignature(parent)
        if (resolved === undefined) return undefined
        const signature = (await resolved.getTarget()) ?? resolved
        const parameters = await signature.getParameters()
        // A REST PARAMETER IS NOT ASKED: its type is the array it collects into, and the position
        // is one element of it. Nothing declares a `...Reactive[]` yet, so it stays a read.
        if (index >= parameters.length - 1 && signature.hasRestParameter)
            return undefined
        const parameter = parameters[index]
        return parameter === undefined
            ? undefined
            : checker.getTypeOfSymbol(parameter)
    }
    if (isVariableDeclaration(parent) && parent.initializer === top)
        return annotated(checker, parent.type)
    if (isReturnStatement(parent)) {
        let holder: Node = parent.parent
        while (
            holder !== undefined &&
            !isFunctionDeclaration(holder) &&
            !isFunctionExpression(holder) &&
            !isArrowFunction(holder) &&
            !isMethodDeclaration(holder)
        )
            holder = holder.parent
        return holder === undefined
            ? undefined
            : annotated(checker, (holder as { type?: TypeNode }).type)
    }
    if (isArrowFunction(parent) && parent.body === top)
        return annotated(checker, parent.type)
    return undefined
}

function annotated(
    checker: Checker,
    type: TypeNode | undefined,
): Promise<Type | undefined> {
    return type === undefined
        ? Promise.resolve(undefined)
        : checker.getTypeFromTypeNode(type)
}

/**
 * Marks each template position the checker proves reads nothing reactive with a `static` read.
 *
 * 14.2 — the read is zero-width, at the position's start. Everything else is bound, which is the
 * inversion: the old
 * question — does it NAME a `Reactive` — let `{big()}` over a function reading `n` be written once.
 *
 * A PROOF IS THREE THINGS: no reactive read inside the span, a syntax that runs no author code
 * but through the answers it hands back (`provePosition`), and those answers. Every member it reads
 * resolves to a plain property — a getter is code, and a member of `any` resolves to nothing — and
 * every value a coercion or the position itself turns into a string is a primitive, whose
 * conversion runs nothing either.
 *
 * ASKED IN TWO BATCHES A FILE, the checker's round trip being what costs. Only the `PROVABLE` kinds
 * of `expressions` are asked about.
 */
async function proveSlots(
    checker: Checker,
    expressions: readonly { position: Position; node: Node }[],
    reads: Read[],
    /** Where each position it proves static starts, added to. */
    statics: Set<number>,
): Promise<void> {
    // Reads are unsorted here; a position holding one is not asked about. A `raw` callee is the
    // framework's name rather than a read of the page's, and `provePosition` exempts its call. A
    // row's item (32.67) is the value on the server, and the client's `Lowering.isLive` binds it.
    const read = (span: Span): boolean => {
        for (const one of reads)
            if (
                one.shape !== 'raw' &&
                one.item === -1 &&
                one.start >= span.start &&
                one.start < span.end
            )
                return true
        return false
    }
    const candidates: {
        span: Span
        primitives: Node[]
        members: Node[]
    }[] = []
    const primitives: Node[] = []
    const members: Node[] = []
    for (const { position: span, node } of expressions) {
        if (!PROVABLE.has(span.kind) || read(span)) continue
        const own = { span, primitives: [] as Node[], members: [] as Node[] }
        if (!provePosition(node, own.primitives, own.members)) continue
        candidates.push(own)
        for (const one of own.primitives) primitives.push(one)
        for (const one of own.members) members.push(one)
    }
    if (candidates.length === 0) return
    const [types, symbols] = await Promise.all([
        primitives.length === 0
            ? Promise.resolve([])
            : checker.getTypeAtLocation(primitives),
        members.length === 0
            ? Promise.resolve([])
            : checker.getSymbolAtLocation(members),
    ])
    const primitive = await Promise.all(
        types.map((type) => type !== undefined && isPrimitiveTyped(type)),
    )
    let atPrimitive = 0
    let atMember = 0
    for (const candidate of candidates) {
        let proven = true
        for (let at = 0; at < candidate.primitives.length; at += 1)
            proven &&= primitive[atPrimitive + at] === true
        for (let at = 0; at < candidate.members.length; at += 1)
            proven &&= isPlainProperty(symbols[atMember + at])
        atPrimitive += candidate.primitives.length
        atMember += candidate.members.length
        if (proven) statics.add(candidate.span.start)
    }
}

/**
 * Every member of the type is a primitive, whose string conversion and comparison run no code.
 * `any` and `unknown` are not: what they hold at runtime is anything.
 */
async function isPrimitiveTyped(type: Type): Promise<boolean> {
    const members = await unionMembers(type)
    for (const member of members)
        if ((member.flags & (TypeFlags.Primitive | TypeFlags.Never)) === 0)
            return false
    return true
}

/**
 * A member read that runs no code: every declaration of it is a data property, an enum member or a
 * module's own binding. A getter is code, and a member the checker cannot resolve — every member
 * of `any` — is nothing it can vouch for.
 */
function isPlainProperty(symbol: CheckedSymbol | undefined): boolean {
    if (symbol === undefined) return false
    if ((symbol.flags & SymbolFlags.Accessor) !== 0) return false
    if (symbol.declarations.length === 0) return false
    for (const declaration of symbol.declarations)
        if (!PLAIN_DECLARATIONS.has(declaration.kind)) return false
    return true
}

const PLAIN_DECLARATIONS: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.PropertySignature,
    SyntaxKind.PropertyDeclaration,
    SyntaxKind.PropertyAssignment,
    SyntaxKind.ShorthandPropertyAssignment,
    SyntaxKind.EnumMember,
    SyntaxKind.VariableDeclaration,
])

/**
 * Drops names that bind a reactive read's value, rather than the `Reactive`, from `reactive`.
 *
 * 31.3 — A BINDING OF A READ HOLDS THE VALUE, and the checker cannot see that. It types the SHADOW,
 * where `let shown = total` is the `Reactive` itself; the lowering reads `total` there, because an
 * un-annotated binding is not a position 31.3 holds in, so `shown` is handed the VALUE. Asked of
 * the shadow alone, `shown` was then classified a `Reactive` too and every use of it lowered to
 * `shown()` — a call on a number. Declared or imported, the name it binds from is the same case.
 *
 * SO THE ANSWER IS CORRECTED WHERE THE TWO PART COMPANY: an un-annotated binding whose initializer
 * hands on a reactive name as its value — through parentheses, a type-only wrapper, a conditional's
 * arms or a logical operand, the positions a read is the value in — is not a `Reactive`. A chain
 * falls out: `let c = b` names `b`, which the shadow typed as one, so `c` holds the value too. An
 * annotated binding is 31.3's own hold and is left alone, and so is a call: `turns(...)` is a
 * `Reactive` in the lowered program exactly as it is in the shadow.
 */
async function dropValueHolders(
    checker: Checker,
    names: readonly Node[],
    reactive: (CheckedSymbol | undefined)[],
): Promise<void> {
    const reactiveIds = new Set<number>()
    for (const symbol of reactive)
        if (symbol !== undefined) reactiveIds.add(symbol.id)
    const owners: number[] = []
    const leaves: Node[] = []
    for (let at = 0; at < names.length; at += 1) {
        const declaration = (names[at] as Node).parent
        if (
            reactive[at] === undefined ||
            !isVariableDeclaration(declaration) ||
            declaration.type !== undefined ||
            declaration.initializer === undefined
        )
            continue
        const before = leaves.length
        valueLeaves(declaration.initializer, leaves)
        for (let leaf = before; leaf < leaves.length; leaf += 1) owners.push(at)
    }
    if (leaves.length === 0) return
    const symbols = await checker.getSymbolAtLocation(leaves)
    for (let leaf = 0; leaf < leaves.length; leaf += 1) {
        const id = symbols[leaf]?.id
        if (id !== undefined && reactiveIds.has(id))
            reactive[owners[leaf] as number] = undefined
    }
}

/**
 * The names an initializer's value can BE, as opposed to names it merely uses: `a` in `(a)`,
 * `a as T`, `c ? a : b` and `a ?? b`, but not in `f(a)` or `a.b`.
 */
function valueLeaves(node: Node, leaves: Node[]): void {
    if (TRANSPARENT.has(node.kind)) {
        valueLeaves(
            (node as unknown as { expression: Node }).expression,
            leaves,
        )
        return
    }
    switch (node.kind) {
        case SyntaxKind.Identifier:
            leaves.push(node)
            return
        case SyntaxKind.ConditionalExpression: {
            const { whenTrue, whenFalse } = node as unknown as {
                whenTrue: Node
                whenFalse: Node
            }
            valueLeaves(whenTrue, leaves)
            valueLeaves(whenFalse, leaves)
            return
        }
        case SyntaxKind.BinaryExpression: {
            const { left, right, operatorToken } = node as unknown as {
                left: Node
                right: Node
                operatorToken: Node
            }
            if (operatorToken.kind === SyntaxKind.CommaToken) {
                valueLeaves(right, leaves)
                return
            }
            if (
                operatorToken.kind === SyntaxKind.QuestionQuestionToken ||
                operatorToken.kind === SyntaxKind.BarBarToken ||
                operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
            ) {
                valueLeaves(left, leaves)
                valueLeaves(right, leaves)
            }
            return
        }
        default:
            return
    }
}

// 23.1 — the four values `route` holds, each a `Reactive` of its own.
const ROUTE_MEMBERS = new Set(['url', 'params', 'name', 'navigating'])

/**
 * 31.16 — `route`'s four values, each read by name as a name bound to a `Reactive` is.
 *
 * `route.params.id` reads `route.params().id`, and the explicit call keeps compiling (31.7). Told
 * by the symbol, as `props` is, so an app's own `route` is not abide's.
 *
 * READ AS A CALL RATHER THAN THROUGH THE CHECKER'S VALUES RECORD (`local`): the record is keyed by
 * a name, and this read is spelled as a member.
 *
 * 23.9 — AND `route.params` IS MARKED, for a checked lowering of a page or a layout to type by what
 * the file's own route promises (`Lowering`): the file is the route, and the running module reads
 * the one `route` every page shares.
 */
async function routeReads(
    checker: Checker,
    abide: Abide,
    sourceFile: Node,
    reads: Read[],
): Promise<void> {
    if (abide.route === undefined) return
    const accesses: Node[] = []
    const owners: Node[] = []
    const visit = (node: Node): void => {
        if (
            isPropertyAccessExpression(node) &&
            isIdentifier(node.expression) &&
            isIdentifier(node.name) &&
            ROUTE_MEMBERS.has(node.name.text)
        ) {
            accesses.push(node)
            owners.push(node.expression)
        }
        node.forEachChild(visit)
    }
    sourceFile.forEachChild(visit)
    if (owners.length === 0) return
    const symbols = await checker.getSymbolAtLocation(owners)
    for (let at = 0; at < accesses.length; at += 1) {
        const symbol = symbols[at]
        if (symbol === undefined) continue
        const declared = await aliasedSymbol(checker, symbol)
        if (declared.valueDeclaration?.path !== abide.route) continue
        const access = accesses[at] as Node
        const read = classifyRead(access)
        if (read === undefined) continue
        read.local = true
        read.routeParams =
            (access as { name?: { text: string } }).name?.text === 'params'
        reads.push(read)
    }
}

/**
 * 32.67 — every read of a `{#for}` row's item, which a client lowering reads off the row's record or
 * its cell inside the row's mount (`Lowering.readItemsAs`), so the value a kept key is handed is
 * written into the row rather than the row remade.
 *
 * EVERY OCCURRENCE IS A READ OF THE ITEM, as a prop's is (`classifyPropRead`): a member written,
 * `row.done = true`, is the value's member, and a call is the value called. A pattern's names are
 * each one, read through the item. The ROW'S OWN KEY is not: the key is asked of the value before
 * there is a row (`List.key`), so it reads the value itself.
 */
async function rowReads(
    checker: Checker,
    sourceFile: Node,
    shadowPath: string,
    spans: ShadowSpans,
    reads: Read[],
): Promise<void> {
    if (spans.items.size === 0) return
    const bound: Node[] = []
    const loops: Node[] = []
    const bind = (name: Node | undefined, loop: Node): void => {
        if (name === undefined) return
        if (isIdentifier(name)) {
            bound.push(name)
            loops.push(loop)
            return
        }
        if (isObjectBindingPattern(name) || isArrayBindingPattern(name))
            for (const element of name.elements)
                bind((element as { name?: Node }).name, loop)
    }
    const visit = (node: Node): void => {
        const declared = rowItemOf(node, spans.items)
        if (declared !== undefined) bind(declared, node)
        node.forEachChild(visit)
    }
    sourceFile.forEachChild(visit)
    if (bound.length === 0) return
    const symbols = await checker.getSymbolAtLocation(bound)
    const found = await Promise.all(
        symbols.map(async (symbol) =>
            symbol === undefined
                ? []
                : await Promise.all(
                      (
                          await checker.getReferencesToSymbolInFile(
                              shadowPath,
                              symbol,
                          )
                      ).map((reference) => reference.resolve()),
                  ),
        ),
    )
    for (let at = 0; at < found.length; at += 1) {
        const name = bound[at] as Node
        const loop = loops[at] as Node
        const item = (rowItemOf(loop, spans.items) as Node).getStart()
        for (const node of found[at] as (Node | undefined)[]) {
            if (node === undefined || node === name) continue
            if (
                spans.positions.holding(node.getStart())?.kind === 'key' &&
                rowLoopOf(node, spans.items) === loop
            )
                continue
            const read = classifyPropRead(node)
            if (read === undefined) continue
            read.item = item
            reads.push(read)
        }
    }
}

/** The item binding `node` declares, where it is a `{#for}` row loop. */
function rowItemOf(node: Node, items: Set<number>): Node | undefined {
    if (!isForOfStatement(node)) return undefined
    const list = node.initializer
    const declared = isVariableDeclarationList(list)
        ? list.declarations[0]?.name
        : undefined
    return declared !== undefined && items.has(declared.getStart())
        ? declared
        : undefined
}

/** The nearest `{#for}` row loop around `node`. */
function rowLoopOf(node: Node, items: Set<number>): Node | undefined {
    for (let at = node.parent; at !== undefined; at = at.parent)
        if (rowItemOf(at, items) !== undefined) return at
    return undefined
}

/**
 * Throws where an inline component the template's own body declares shares a name with one the
 * file's `<script>` or `<script module>` declares.
 *
 * 32.55 — THE TEMPLATE'S OWN BODY IS ITS FILE'S SCOPE, so the two are one name declared twice. The
 * checker reports it on the projection, but a build reports nothing the checker says, and the
 * module it emits would not load. Imports are refused where the file is parsed (`parseAbide`).
 */
function refuseDeclared(
    statements: readonly Node[],
    scriptsEnd: number,
    file: AbideFile,
): void {
    if (file.components.length === 0) return
    const names = new Set<string>()
    const bind = (name: Node | undefined): void => {
        if (name === undefined) return
        if (isIdentifier(name)) {
            names.add(name.text)
            return
        }
        if (isObjectBindingPattern(name) || isArrayBindingPattern(name))
            for (const element of name.elements)
                bind((element as { name?: Node }).name)
    }
    for (const statement of statements) {
        if (statement.getStart() >= scriptsEnd) break
        if (isVariableStatement(statement))
            for (const declaration of statement.declarationList.declarations)
                bind(declaration.name)
        else if (
            isFunctionDeclaration(statement) ||
            isClassDeclaration(statement) ||
            isEnumDeclaration(statement)
        )
            bind(statement.name)
    }
    for (const component of file.components)
        if (names.has(component.name))
            throw new Error(
                `abide: {#component ${component.name}} is declared inline and \`${component.name}\` is also declared by its file's script — one name, two things. Rename one. RULEBOOK 32.55.`,
            )
}

/**
 * 27.13 — each `onConfig(…)` standing as a statement at the top of a `<script server>`, as a read of
 * its callee, pushed onto `reads`.
 *
 * The callee says which are abide's, as `props`'s does. A call anywhere else — inside a function,
 * or handing its unfiling back to a name — is filed all the same, and declares nothing.
 */
async function configReads(
    checker: Checker,
    abide: Abide,
    sourceFile: Node & { statements: readonly Node[] },
    servers: Span,
    reads: Read[],
): Promise<void> {
    if (abide.onConfig === undefined) return
    const callees: Node[] = []
    for (const statement of sourceFile.statements) {
        const start = statement.getStart()
        if (start < servers.start) continue
        if (start >= servers.end) break
        if (
            isExpressionStatement(statement) &&
            isCallExpression(statement.expression) &&
            isIdentifier(statement.expression.expression)
        )
            callees.push(statement.expression.expression)
    }
    if (callees.length === 0) return
    const named = await checker.getSymbolAtLocation(callees)
    for (let at = 0; at < callees.length; at += 1) {
        const symbol = named[at]
        if (symbol === undefined) continue
        const callee = await aliasedSymbol(checker, symbol)
        if (
            callee.name !== 'onConfig' ||
            callee.valueDeclaration?.path !== abide.onConfig
        )
            continue
        const node = callees[at] as Node
        reads.push(newRead(node.getStart(), node.end, 'config'))
    }
}

/**
 * The reads a `props<Props>()` destructuring contributes, pushed onto `reads`.
 *
 * 33 — WHAT `props<Props>()` BINDS, and it is a second question from 31.3's rather than a case of
 * it: a prop is not a `Reactive` and is not typed as one, so no type answers this. The CALLEE
 * does: abide's own `props`, which an app's function of that spelling is not. The pattern is flat
 * (33.14), and every name it binds is one accessor (33.4).
 *
 * THREE KINDS OF READ COME BACK: the call itself, which lowers to the record the caller passed;
 * each default, which lowers to an accessor answering it; and every occurrence of every name the
 * pattern bound.
 *
 * 33.6, 33.7 — A PROP THE CHILD WRITES IS A CELL, and the child is the only side that can tell: a
 * name assigned, updated, or handed on as a `bind:` operand. Its key rides the call's read, its
 * default becomes a cell too, and every occurrence reads through the accessor as a `Reactive`.
 */
async function propsReads(
    checker: Checker,
    abide: Abide,
    sourceFile: Node & { statements: readonly Node[] },
    shadowPath: string,
    scriptsEnd: number,
    positions: PositionTable,
    reads: Read[],
): Promise<void> {
    // The spelling only says which calls are worth asking about; the callee says which are abide's.
    const calls: { pattern: Node; call: Node; local: boolean }[] = []
    const callees: Node[] = []
    const take = (statement: Node, local: boolean): void => {
        if (!isVariableStatement(statement)) return
        for (const declaration of statement.declarationList.declarations) {
            const call = declaration.initializer
            if (
                call === undefined ||
                !isCallExpression(call) ||
                !isIdentifier(call.expression) ||
                call.expression.text !== (local ? INLINE_PROPS : 'props')
            )
                continue
            calls.push({ pattern: declaration.name, call, local })
            callees.push(call.expression)
        }
    }
    for (const statement of sourceFile.statements) {
        if (statement.getStart() >= scriptsEnd) break
        take(statement, false)
    }
    // 32.40 — AND EACH INLINE COMPONENT'S HEAD, inside the function it is projected as. Its names
    // are that function's, so a read of one is local as a branch-local name is (14.8).
    for (const { node } of positions.nodesIn(sourceFile, HEAD)) take(node, true)
    if (calls.length === 0 || abide.props === undefined) return
    const named = await checker.getSymbolAtLocation(callees)
    // One entry per name a pattern binds: the key it takes, the call's read its key joins where
    // the child writes it, and its default's pair.
    const bound: Node[] = []
    const bindings: {
        key: string
        call: Read
        defaults: Read[]
        rest: boolean
        local: boolean
    }[] = []
    for (let at = 0; at < calls.length; at += 1) {
        const symbol = named[at]
        if (symbol === undefined) continue
        const callee = await aliasedSymbol(checker, symbol)
        if (callee.valueDeclaration?.path !== abide.props) continue
        const { pattern, call, local } = calls[at] as (typeof calls)[number]
        const callRead = newRead(call.getStart(), call.end, 'props')
        reads.push(callRead)
        // 33.3 — `const all = props()` is the untyped record itself, and there is no pattern
        // to walk. Its members are read through `all`, which the lowering leaves alone.
        if (!isObjectBindingPattern(pattern)) continue
        for (const element of pattern.elements) {
            // 33.14 — FLAT: a rename, a default and a rest element, and no nested pattern.
            const name = element.name
            if (name === undefined || !isIdentifier(name))
                throw new Error(
                    'abide: a props pattern is flat — a rename, a default and a rest element, and no nested pattern. RULEBOOK 33.14.',
                )
            const renamed = element.propertyName
            const key =
                renamed !== undefined && isIdentifier(renamed)
                    ? renamed.text
                    : name.text
            const defaults: Read[] = []
            if (element.initializer !== undefined) {
                const open = element.initializer.getStart()
                const opening = newRead(open, open, 'defaultOpen')
                opening.keys.push(key)
                callRead.keys.push(key)
                defaults.push(
                    opening,
                    newRead(
                        element.initializer.end,
                        element.initializer.end,
                        'defaultClose',
                    ),
                )
                reads.push(...defaults)
            } else if (element.dotDotDotToken === undefined) {
                // 33.4 — A PROP THE CALLER LEFT OUT IS `undefined`, and has no accessor to read it
                // through: every binding is given one, inert wherever the caller passed the key.
                const absent = newRead(name.end, name.end, 'absent')
                defaults.push(absent)
                reads.push(absent)
            }
            bound.push(name)
            bindings.push({
                key,
                call: callRead,
                defaults,
                rest: element.dotDotDotToken !== undefined,
                local,
            })
        }
    }
    if (bound.length === 0) return

    const symbols = await checker.getSymbolAtLocation(bound)
    const found = await Promise.all(
        symbols.map(async (symbol) =>
            symbol === undefined
                ? []
                : await Promise.all(
                      (
                          await checker.getReferencesToSymbolInFile(
                              shadowPath,
                              symbol,
                          )
                      ).map((reference) => reference.resolve()),
                  ),
        ),
    )
    for (let at = 0; at < found.length; at += 1) {
        const binding = bindings[at] as (typeof bindings)[number]
        if (binding.rest) {
            restReads(found[at] as (Node | undefined)[], reads)
            continue
        }
        const uses: Read[] = []
        let written = false
        for (const node of found[at] as (Node | undefined)[]) {
            // The binding itself is the pattern's, and not a use of the name.
            if (
                node === undefined ||
                node.parent?.kind === SyntaxKind.BindingElement
            )
                continue
            const read = classifyRead(node)
            if (read === undefined) continue
            if (
                read.shape === 'write' ||
                read.shape === 'update' ||
                isBindOperand(positions, node)
            )
                written = true
            uses.push(read)
        }
        if (!written) {
            for (const node of found[at] as (Node | undefined)[]) {
                if (node === undefined) continue
                const read = classifyPropRead(node)
                if (read === undefined) continue
                read.local = binding.local
                reads.push(read)
            }
            continue
        }
        binding.call.path.push({ name: binding.key, start: 0, end: 0 })
        for (const read of binding.defaults) read.through = true
        for (const read of uses) {
            read.through = true
            read.local = binding.local
            reads.push(read)
        }
    }
}

/**
 * 33.15 — the reads of a props rest element: `rest.note`, each read of the accessor it holds.
 *
 * THE REST ELEMENT IS THE RECORD OF ACCESSORS the caller passed, not one of them, so the name alone
 * is never called — `rest()` would call the record. A member read is the key's accessor called,
 * `?.` because a key the caller left out has none (33.4), and `rest.note()` is that accessor called
 * by hand, left alone as 31.7's is.
 *
 * 33.22 — HANDED ON WHOLE, IT IS THE VALUES. A `{...rest}` enumerates what it is given, and given
 * the accessors an element's spread skipped every one as a function and a component's passed each
 * child an accessor where its value was due.
 */
function restReads(nodes: (Node | undefined)[], reads: Read[]): void {
    for (const node of nodes) {
        const parent = node?.parent
        if (
            node === undefined ||
            parent === undefined ||
            parent.kind === SyntaxKind.BindingElement ||
            parent.kind === SyntaxKind.TypeQuery
        )
            continue
        if (isPropertyAccessExpression(parent) && parent.expression === node) {
            const outer = parent.parent
            if (isCallExpression(outer) && outer.expression === parent) continue
            reads.push(newRead(node.getStart(), parent.end, 'restMember'))
            continue
        }
        const whole = newRead(node.getStart(), node.end, 'restWhole')
        // `{ rest }` is a key and a value, and only the value lowers.
        if (parent.kind === SyntaxKind.ShorthandPropertyAssignment)
            whole.keys = ['shorthand']
        reads.push(whole)
    }
}

/** A name standing alone as a `bind:` operand, on an element or on a component. */
function isBindOperand(positions: PositionTable, node: Node): boolean {
    return holdsReactive(positions.of(node))
}

async function isReactiveSymbol(
    checker: Checker,
    abide: Abide,
    symbol: CheckedSymbol,
): Promise<boolean> {
    const type = await checker.getTypeOfSymbol(symbol)
    return type !== undefined && isReactiveType(checker, abide, type, false)
}

/**
 * Orders reads by offset, a default's open before a read at the same offset and its close after.
 *
 * ASCENDING, AND AN INSERTION KNOWS WHICH SIDE IT IS ON. A default's open stands at the same
 * offset as the first read inside it — `currency = fallback` — and a sort by offset alone leaves
 * which comes first to the order the two passes happened to push in.
 */
function byPosition(left: Read, right: Read): number {
    return left.start - right.start || side(left) - side(right)
}

function side(read: Read): number {
    if (read.shape === 'defaultOpen') return -1
    return read.shape === 'defaultClose' ? 1 : 0
}
