import {
    type BinaryExpression,
    type CallExpression,
    type Node,
    type PostfixUnaryExpression,
    type PrefixUnaryExpression,
    SyntaxKind,
} from 'typescript/unstable/ast'
import {
    isBinaryExpression,
    isCallExpression,
    isElementAccessExpression,
    isExpressionStatement,
    isForStatement,
    isPostfixUnaryExpression,
    isPrefixUnaryExpression,
    isPropertyAccessExpression,
    isShorthandPropertyAssignment,
} from 'typescript/unstable/ast/is'
import type { Span } from './projectShadow.ts'
import { REACTIVE_MEMBERS } from './REACTIVE_MEMBERS.ts'

/**
 * One occurrence of a name bound to a `Reactive`, and what it lowers as.
 *
 * The ROLE is read off the checker's own syntax tree, so what a write's right-hand side is, where a
 * statement ends and whether `{ n }` is a literal are TypeScript's answers rather than a token
 * walk's guess at them. Every offset is into the file's projection (`projectShadow`).
 *
 * ONE SHAPE IS NOT A REACTIVE NAME: `raw` is the callee of a template expression's bare `raw(…)`
 * (32.25), which lowers to the framework's own `raw`; a `<script>`'s is left as written. It rides
 * this list because it is a rewrite at an occurrence, which is what the splice walks; what the
 * checker proved about a whole position is `CheckerAnswer`'s.
 *
 * THE SHAPE IS FIXED: every field on every read, so `Lowering`'s splice sees one hidden class.
 */
export type Read = {
    /** The name's own span. */
    start: number
    end: number
    /**
     * What the occurrence lowers as.
     *
     * `value` lowers to `n()`; `asWritten` stays as written (`n.set(v)`, 31.5); `member` is one of
     * the `Reactive`'s own members referenced rather than called, named by `path`; `call` is the
     * explicit `n()` (31.7), which `arguments` says was given any; `shorthand` is `{ n }`;
     * `write` and `update` are 31.4, and 31.8 where `path` is not empty.
     *
     * 33's five: the `props<Props>()` call, which lowers to the record the caller passed; the pair
     * that brackets a binding element's initializer, which together make a default an accessor;
     * `absent`, which gives a binding with no default an accessor of `undefined` (33.4); and
     * `restMember`, a member of the rest element, which calls that key's accessor (33.15), beside
     * `restWhole`, the rest element handed on as one value (33.22). The
     * pair and `absent` are INSERTIONS — zero-width, so what stands between the pair goes on being
     * lowered by the same walk, and a default reading a `Reactive` still reads it.
     */
    shape:
        | 'value'
        | 'asWritten'
        | 'member'
        | 'call'
        | 'shorthand'
        | 'write'
        | 'update'
        | 'props'
        | 'defaultOpen'
        | 'defaultClose'
        | 'absent'
        | 'restMember'
        | 'restWhole'
        | 'raw'
    /** What the rewrite replaces: the name, or a whole write or update from its first token. */
    from: number
    to: number
    /** A write's operator without its `=` (`''` for `=` itself); an update's `+` or `-`. */
    operator: string
    prefix: boolean
    /** A write or an update whose value nothing reads (`isDiscarded`). */
    discarded: boolean
    arguments: number
    /**
     * 31.8 — the member path between the name and the write.
     *
     * A property's name, or the span of a computed segment, which may itself hold reads. On the
     * `props` call, the keys the child writes, by name (33.6).
     */
    path: { name: string | undefined; start: number; end: number }[]
    value: Span | undefined
    /**
     * 33.6 — the name is a props accessor handing back the prop's cell.
     *
     * So the `Reactive` every rewrite reaches is `name()` rather than the name. On a default's
     * pair, that the default is one too.
     */
    through: boolean
    /** 32.32 — the name is bound to a `reactive(…)` whose options declare `by`. */
    byValue: boolean
    /** 14.8 — the name is declared by a branch-local `<script>`, inside the body it scopes. */
    local: boolean
    /** 33.20 — on the `props` call, the keys its pattern defaults; on a default's opening, its key. */
    keys: string[]
    /**
     * 23.9 — on `route.params` in a page or a layout, the route literal and which of the two the
     * file is.
     */
    routeParams: [pattern: string, kind: string] | undefined
}

/**
 * A `Read` with every field set, at its default where not given.
 *
 * THE SHAPE, IN ONE PLACE. `Read`'s invariant is that every read carries every field, and a second
 * hand-written literal is exactly how that stops being true — so every read is minted here and
 * then sets only what it parts company over. A span of zero width is an INSERTION.
 */
export function newRead(
    start: number,
    end: number,
    shape: Read['shape'] = 'value',
): Read {
    return {
        start,
        end,
        shape,
        from: start,
        to: end,
        operator: '',
        prefix: false,
        discarded: false,
        arguments: 0,
        path: [],
        value: undefined,
        through: false,
        byValue: false,
        local: false,
        keys: [],
        routeParams: undefined,
    }
}

function isAssigned(outer: Node, target: Node): outer is BinaryExpression {
    return (
        isBinaryExpression(outer) &&
        outer.left === target &&
        outer.operatorToken.kind >= SyntaxKind.FirstAssignment &&
        outer.operatorToken.kind <= SyntaxKind.LastAssignment
    )
}

/**
 * Whether nothing reads an expression's value.
 *
 * A statement, a `for`'s own two, or either side of a comma whose own value nothing reads —
 * `a = 1, b = 2` as a statement is two discarded writes. The comma is not optional: a write whose
 * value IS read lowers to a form beginning with `(`, and at the head of a line JavaScript inserts
 * no semicolon in front of one.
 */
function isDiscarded(expression: Node): boolean {
    const holder = expression.parent
    if (isExpressionStatement(holder)) return true
    if (isForStatement(holder))
        return (
            holder.incrementor === expression ||
            holder.initializer === expression
        )
    if (
        isBinaryExpression(holder) &&
        holder.operatorToken.kind === SyntaxKind.CommaToken
    )
        return holder.left === expression || isDiscarded(holder)
    return false
}

function isIncrement(
    outer: Node,
): outer is PrefixUnaryExpression | PostfixUnaryExpression {
    return (
        (isPrefixUnaryExpression(outer) || isPostfixUnaryExpression(outer)) &&
        (outer.operator === SyntaxKind.PlusPlusToken ||
            outer.operator === SyntaxKind.MinusMinusToken)
    )
}

/**
 * Whether a name under `parent` is no read at all, for either classifier.
 *
 * An import or export specifier names a binding rather than reading one, and a `typeof n` is a
 * type position.
 */
function isNotARead(parent: Node): boolean {
    switch (parent.kind) {
        case SyntaxKind.ImportSpecifier:
        case SyntaxKind.ImportClause:
        case SyntaxKind.NamespaceImport:
        case SyntaxKind.ExportSpecifier:
        case SyntaxKind.TypeQuery:
            return true
        default:
            return false
    }
}

/**
 * Classifies one occurrence of a prop the child only reads, or `undefined` where it is no read.
 *
 * A name the `props` pattern bound (33.4, 33.9). Every occurrence is a read of that key's
 * accessor, which is where this parts company with `classifyRead`: `onsave()` is the prop's own
 * value being CALLED and lowers to `onsave()()`, where the same spelling on a `Reactive` is 31.7's
 * explicit read; and `amount.set` is the value's member, a prop nothing writes having no cell. A
 * prop the child writes is `classifyRead`'s.
 */
export function classifyPropRead(node: Node): Read | undefined {
    const parent = node.parent
    if (isNotARead(parent)) return undefined
    if (parent.kind === SyntaxKind.BindingElement) {
        // The binding itself, and the key it renames from — neither is a read.
        if ((parent as { name?: Node }).name === node) return undefined
        if ((parent as { propertyName?: Node }).propertyName === node)
            return undefined
    }
    const read = newRead(node.getStart(), node.end)
    if (isShorthandPropertyAssignment(parent)) read.shape = 'shorthand'
    return read
}

/**
 * Classifies one occurrence of a name bound to a `Reactive` as the `Read` it lowers as.
 *
 * `undefined` for an occurrence that is not a read at all: the declaration itself, an import or
 * export specifier, and a `typeof n` in a type.
 */
export function classifyRead(node: Node): Read | undefined {
    const parent = node.parent
    if (isNotARead(parent)) return undefined
    if (
        parent.kind === SyntaxKind.VariableDeclaration &&
        (parent as { name?: Node }).name === node
    )
        return undefined
    const read = newRead(node.getStart(), node.end)

    // 31.3 — AN `await` OPERAND HOLDS THE `Reactive`. A `Reactive` is thenable (1.4), so `await n`
    // is already the spelling for its settling (2.8) in every `.ts` file; lowered to `await n()`
    // it became a READ instead, which takes what has landed and throws where nothing has (2.10) —
    // the one position where a read is never what was meant.
    //
    // NOTHING IS SCHEDULED BY THIS. The `await` is the author's own, the component is `async`
    // because their `<script>` holds one, and `render` awaits it (35.5). Two of them run one after
    // the other, as they would in any other file.
    //
    // `await n()` IS UNTOUCHED, the call being the operand rather than the name — 31.7's explicit
    // read, awaited, which is a read of what has landed and still throws.
    if (parent.kind === SyntaxKind.AwaitExpression) {
        read.shape = 'asWritten'
        return read
    }

    if (isCallExpression(parent) && parent.expression === node) {
        read.shape = 'call'
        read.arguments = parent.arguments.length
        return read
    }
    if (isShorthandPropertyAssignment(parent)) {
        read.shape = 'shorthand'
        return read
    }

    // The member path, walked up while the name stands on the LEFT of each access.
    let top: Node = node
    while (true) {
        const up = top.parent
        if (isPropertyAccessExpression(up) && up.expression === top) {
            // 31.5 — the `Reactive`'s own member is the API, and no path. Called, it stays as
            // written; REFERENCED, it is handed over bound, so `promise.then(n.set)` writes `n`.
            if (top === node && REACTIVE_MEMBERS.has(up.name.text)) {
                const outer = up.parent
                if (
                    (isCallExpression(outer) && outer.expression === up) ||
                    isAssigned(outer, up)
                ) {
                    read.shape = 'asWritten'
                    return read
                }
                read.shape = 'member'
                read.to = up.end
                read.path.push({
                    name: up.name.text,
                    start: up.name.getStart(),
                    end: up.name.end,
                })
                return read
            }
            read.path.push({
                name: up.name.text,
                start: up.name.getStart(),
                end: up.name.end,
            })
        } else if (isElementAccessExpression(up) && up.expression === top)
            read.path.push({
                name: undefined,
                start: up.argumentExpression.getStart(),
                end: up.argumentExpression.end,
            })
        else break
        top = up
    }

    const outer = top.parent
    if (isAssigned(outer, top)) {
        read.shape = 'write'
        read.operator = outer.operatorToken.getText().slice(0, -1)
        read.to = outer.end
        read.value = { start: outer.right.getStart(), end: outer.right.end }
        read.discarded = isDiscarded(outer)
        return read
    }
    if (isIncrement(outer)) {
        read.shape = 'update'
        read.operator = outer.operator === SyntaxKind.PlusPlusToken ? '+' : '-'
        read.prefix = isPrefixUnaryExpression(outer)
        read.from = outer.getStart()
        read.to = outer.end
        read.discarded = isDiscarded(outer)
        return read
    }
    // A path that ends in anything else is a read of the value, whose members follow it.
    read.path.length = 0
    return read
}

/**
 * Whether syntax proves a template position runs no author code; the checker confirms the rest.
 *
 * 14.2 — WHETHER EVALUATING A TEMPLATE EXPRESSION CAN RUN AUTHOR CODE, as far as SYNTAX can say.
 * Tracking happens where code runs (14.11), so an expression that runs none reads nothing reactive
 * however its names are bound — and anything that can run code is unproven and gets a binding,
 * runtime tracking deciding what it actually read.
 *
 * WHAT RUNS NO CODE: a literal, a name, the operators that only compare or branch (`!`, `===`,
 * `&&`, `??`, `?:`, `typeof`), and the type-only wrappers. WHAT RUNS CODE ONLY THROUGH ITS OPERAND'S
 * TYPE: arithmetic, ordering, loose equality and a template literal coerce an object through its
 * `valueOf`/`toString`, so each operand is handed back in `primitives` for the checker to confirm;
 * and a member read runs a getter, so each is handed back in `members` for the checker to confirm
 * is a plain property. EVERYTHING ELSE — a call, `new`, a tagged template, an element access, an
 * assignment, `in`, `instanceof`, a function, a literal object — is unproven here, with no question
 * asked of the checker at all.
 *
 * `false` is "unproven", never "reads a Reactive": this is a proof or nothing.
 *
 * A POSITION'S OWN VALUE IS DEMANDED PRIMITIVE, because every position this is asked of converts it
 * to a string or tests it, and an object's `toString` is code. THE ONE OBJECT EXEMPT is 32.25's
 * `raw(x)`: a template's bare `raw(` is always the framework's (`expressionFacts`), which converts its
 * argument and whose result the escaper reads a field of. It is also the one value a LIVE text
 * binding cannot write (`setText` writes text, never markup), so leaving it unproven is not only a
 * binding too many — it put `<b>hi</b>` on the screen where the server had painted an element.
 */
export function provePosition(
    node: Node,
    primitives: Node[],
    members: Node[],
): boolean {
    const argument = rawArgument(node)
    const value = argument ?? node
    primitives.push(value)
    return proveStatic(value, primitives, members)
}

/**
 * `node` as a bare `raw(…)` call, or `undefined` where it is none.
 *
 * 32.25 — THE SPELLING THE TEMPLATE LOWERS TO THE FRAMEWORK'S `raw`, whatever it is handed: a
 * member (`markdown.raw(x)`) is that object's method, and a `raw` that is not called is whatever
 * the file bound.
 */
function rawCall(node: Node): CallExpression | undefined {
    if (!isCallExpression(node)) return undefined
    const callee = node.expression
    return callee.kind === SyntaxKind.Identifier &&
        (callee as unknown as { text: string }).text === 'raw'
        ? node
        : undefined
}

/**
 * The one value a bare `raw(x)` converts, `TRANSPARENT` wrappers aside, or `undefined` where `node`
 * is none.
 *
 * A call handed a spread, or other than one argument, is still the framework's `raw` (`rawCall`),
 * and is not exempt: what it converts is no one node, and a spread runs an iterator.
 */
function rawArgument(node: Node): Node | undefined {
    let inner = node
    while (TRANSPARENT.has(inner.kind))
        inner = (inner as unknown as { expression: Node }).expression
    const call = rawCall(inner)
    if (call === undefined || call.arguments.length !== 1) return undefined
    const only = call.arguments[0] as Node
    return only.kind === SyntaxKind.SpreadElement ? undefined : only
}

/**
 * Collects a template expression's bare `raw(…)` callees into `rawCallees` where it is handed one,
 * and throws where it awaits.
 *
 * WHAT A TEMPLATE EXPRESSION'S OWN TREE SAYS WITHOUT A TYPE: every bare `raw(…)` callee
 * (`rawCall`), lowered to the framework's `raw` (32.25), and whether it AWAITS (32.57).
 *
 * A TEMPLATE EXPRESSION CANNOT `await`: each is lowered into an ordinary arrow, an argument or an
 * initializer inside a function that is not `async`, so `{await rows}` emitted a module that does
 * not parse, reported by bun against the emitted file rather than the page. UNLESS THE EXPRESSION
 * MAKES ITS OWN FUNCTION — `onclick={async () => await save()}` is an ordinary handler — so the
 * walk stops looking for an `await` at the first function it enters, and keeps looking for `raw`.
 */
export function expressionFacts(
    node: Node,
    rawCallees: Node[] | undefined,
    inFunction = false,
): void {
    if (!inFunction && node.kind === SyntaxKind.AwaitExpression)
        throw new Error(
            `abide: a template position cannot await, and \`${node.getText()}\` does. A template expression is lowered into an ordinary function, so there is nothing here to await in — await inside a handler or a reactive body, or read the value and let the position fill. RULEBOOK 32.57.`,
        )
    if (rawCallees !== undefined) {
        const call = rawCall(node)
        if (call !== undefined) rawCallees.push(call.expression)
    }
    const nested = inFunction || FUNCTIONS.has(node.kind)
    node.forEachChild((child) => {
        expressionFacts(child, rawCallees, nested)
    })
}

/** The syntax kinds that open a function scope of their own. */
export const FUNCTIONS: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.ArrowFunction,
    SyntaxKind.FunctionExpression,
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.MethodDeclaration,
    SyntaxKind.GetAccessor,
    SyntaxKind.SetAccessor,
    SyntaxKind.Constructor,
    SyntaxKind.ClassStaticBlockDeclaration,
])

/**
 * The wrappers whose value is the expression they wrap: parentheses, and the ones that only say
 * what type it is. `typeof` and `void` are not among them — each makes a value of its own.
 */
export const TRANSPARENT: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.ParenthesizedExpression,
    SyntaxKind.AsExpression,
    SyntaxKind.SatisfiesExpression,
    SyntaxKind.NonNullExpression,
    SyntaxKind.TypeAssertionExpression,
])

/** Whether syntax proves `node` runs no author code, queuing what the checker must confirm. */
function proveStatic(node: Node, primitives: Node[], members: Node[]): boolean {
    if (TRANSPARENT.has(node.kind))
        return proveStatic(
            (node as unknown as { expression: Node }).expression,
            primitives,
            members,
        )
    switch (node.kind) {
        case SyntaxKind.StringLiteral:
        case SyntaxKind.NumericLiteral:
        case SyntaxKind.BigIntLiteral:
        case SyntaxKind.NoSubstitutionTemplateLiteral:
        case SyntaxKind.TrueKeyword:
        case SyntaxKind.FalseKeyword:
        case SyntaxKind.NullKeyword:
        case SyntaxKind.Identifier:
            return true
        // Not `TRANSPARENT`, and runs no code but its operand's: its value is a primitive.
        case SyntaxKind.TypeOfExpression:
        case SyntaxKind.VoidExpression:
            return proveStatic(
                (node as unknown as { expression: Node }).expression,
                primitives,
                members,
            )
        case SyntaxKind.PrefixUnaryExpression: {
            const { operator, operand } = node as unknown as {
                operator: SyntaxKind
                operand: Node
            }
            if (operator === SyntaxKind.ExclamationToken)
                return proveStatic(operand, primitives, members)
            if (
                operator === SyntaxKind.PlusPlusToken ||
                operator === SyntaxKind.MinusMinusToken
            )
                return false
            primitives.push(operand)
            return proveStatic(operand, primitives, members)
        }
        case SyntaxKind.ConditionalExpression: {
            const { condition, whenTrue, whenFalse } = node as unknown as {
                condition: Node
                whenTrue: Node
                whenFalse: Node
            }
            return (
                proveStatic(condition, primitives, members) &&
                proveStatic(whenTrue, primitives, members) &&
                proveStatic(whenFalse, primitives, members)
            )
        }
        case SyntaxKind.TemplateExpression: {
            for (const span of (
                node as unknown as {
                    templateSpans: readonly { expression: Node }[]
                }
            ).templateSpans) {
                primitives.push(span.expression)
                if (!proveStatic(span.expression, primitives, members))
                    return false
            }
            return true
        }
        case SyntaxKind.PropertyAccessExpression: {
            const access = node as unknown as { expression: Node; name: Node }
            if (access.name.kind !== SyntaxKind.Identifier) return false
            members.push(access.name)
            return proveStatic(access.expression, primitives, members)
        }
        case SyntaxKind.BinaryExpression: {
            const binary = node as BinaryExpression
            const operator = binary.operatorToken.kind
            if (!NON_COERCING.has(operator)) {
                if (!COERCING.has(operator)) return false
                primitives.push(binary.left, binary.right)
            }
            return (
                proveStatic(binary.left, primitives, members) &&
                proveStatic(binary.right, primitives, members)
            )
        }
        default:
            return false
    }
}

// The binary operators that read their operands without converting them.
const NON_COERCING: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.AmpersandAmpersandToken,
    SyntaxKind.BarBarToken,
    SyntaxKind.QuestionQuestionToken,
    SyntaxKind.EqualsEqualsEqualsToken,
    SyntaxKind.ExclamationEqualsEqualsToken,
    SyntaxKind.CommaToken,
])

// The ones that convert an object operand through author code, and so run none only over
// primitives. `in` and `instanceof` are in neither: a proxy's `has` and `Symbol.hasInstance` are
// code whatever the operand's type.
const COERCING: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.PlusToken,
    SyntaxKind.MinusToken,
    SyntaxKind.AsteriskToken,
    SyntaxKind.SlashToken,
    SyntaxKind.PercentToken,
    SyntaxKind.AsteriskAsteriskToken,
    SyntaxKind.LessThanToken,
    SyntaxKind.GreaterThanToken,
    SyntaxKind.LessThanEqualsToken,
    SyntaxKind.GreaterThanEqualsToken,
    SyntaxKind.EqualsEqualsToken,
    SyntaxKind.ExclamationEqualsToken,
    SyntaxKind.AmpersandToken,
    SyntaxKind.BarToken,
    SyntaxKind.CaretToken,
    SyntaxKind.LessThanLessThanToken,
    SyntaxKind.GreaterThanGreaterThanToken,
    SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
])
