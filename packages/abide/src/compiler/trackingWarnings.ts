import { type Node, SyntaxKind } from 'typescript/unstable/ast'
import {
    isArrowFunction,
    isAwaitExpression,
    isBinaryExpression,
    isCallExpression,
    isConditionalExpression,
    isDoStatement,
    isExpressionStatement,
    isForOfStatement,
    isForStatement,
    isFunctionExpression,
    isIdentifier,
    isIfStatement,
    isParenthesizedExpression,
    isPropertyAccessExpression,
    isVariableStatement,
    isWhileStatement,
} from 'typescript/unstable/ast/is'
import { FUNCTIONS } from './classifyRead.ts'
import { SUBJECT } from './projectShadow.ts'

// 14.14, 14.15, 14.16 — WHERE A READ STANDS IN A BODY THAT TRACKS, and the three ways it can stand
// there and not do what it looks like doing. Read off the checker's own tree of the projection, so a
// position here is a projection offset. Each is a warning rather than a refusal: the program is
// valid, and a read that is not tracked is sometimes what was meant.
//
// A TRACKED BODY is an unkeyed `reactive` body (14.3), a `watch` effect (14.6), or a template
// position (14.2) — the parenthesised statement the projection wraps a slot in. A listener is not
// one (14.9), and the projection hands it to `__on` rather than wrapping it, which is what tells
// the two apart here.

export type Warning = { at: number; message: string }

// A callback these hand a function to runs it before they return, so a read inside it is the
// body's own read. Anything else — `then`, `setTimeout`, an event, a function kept for later — may
// run after the body has returned, when nothing is tracking.
const SYNCHRONOUS = new Set([
    'map',
    'filter',
    'reduce',
    'reduceRight',
    'forEach',
    'some',
    'every',
    'find',
    'findIndex',
    'findLast',
    'findLastIndex',
    'flatMap',
    'sort',
    'toSorted',
    'replace',
    'replaceAll',
    'from',
])

type Body = { node: Node; kind: 'reactive' | 'watch' | 'template' }

// Past any parentheses around `node`, to what holds it.
function holderOf(node: Node): { child: Node; parent: Node } {
    let child = node
    while (isParenthesizedExpression(child.parent)) child = child.parent
    return { child, parent: child.parent }
}

function calleeName(call: Node): string | undefined {
    if (!isCallExpression(call)) return undefined
    const callee = call.expression
    if (isIdentifier(callee)) return callee.text
    if (isPropertyAccessExpression(callee) && isIdentifier(callee.name))
        return callee.name.text
    return undefined
}

// Whether a function is a body that tracks, and which kind.
function trackedKind(fn: Node): Body['kind'] | undefined {
    if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return undefined
    const { child, parent } = holderOf(fn)
    if (!isCallExpression(parent) || parent.arguments[0] !== child)
        return undefined
    const name = calleeName(parent)
    // 14.4 — a body declaring a parameter is keyed, and does not track.
    if (name === 'reactive' && fn.parameters.length === 0) return 'reactive'
    if (name === 'watch') return 'watch'
    return undefined
}

// Whether a function a tracked body creates runs before the body returns.
function runsSynchronously(fn: Node): boolean {
    const { child, parent } = holderOf(fn)
    // 14.18 — A COMPONENT'S `bind:` PAIR (32.6) is not kept for later: the child calls `get` inside a body
    // that tracks, and `set` where it writes, so a read in either is where it should be. The
    // projection hands the pair to `__bound`, which is what tells it from any other prop.
    const member =
        parent.kind === SyntaxKind.PropertyAssignment ? parent : child
    if (
        member.parent.kind === SyntaxKind.ObjectLiteralExpression &&
        calleeName(holderOf(member.parent).parent) === '__bound'
    )
        return true
    if (!isCallExpression(parent)) return false
    if (parent.expression === child) return true
    const name = calleeName(parent)
    return name !== undefined && SYNCHRONOUS.has(name)
}

// Whether `child` is the condition of `parent`, which decides what else runs.
function isCondition(child: Node, parent: Node): boolean {
    if (
        isIfStatement(parent) ||
        isWhileStatement(parent) ||
        isDoStatement(parent)
    )
        return parent.expression === child
    if (isConditionalExpression(parent)) return parent.condition === child
    if (isForStatement(parent)) return parent.condition === child
    if (isBinaryExpression(parent)) {
        const operator = parent.operatorToken.kind
        return (
            parent.left === child &&
            (operator === SyntaxKind.AmpersandAmpersandToken ||
                operator === SyntaxKind.BarBarToken ||
                operator === SyntaxKind.QuestionQuestionToken)
        )
    }
    return false
}

// The template's positions start at `templateStart`; a statement there wrapped in parentheses is a
// slot, a subject or a key, and one that is a call is a listener or a prop handed to a component.
// An `{#if}`'s subject is the parenthesised condition of the `if` it is projected as.
function templateBody(
    child: Node,
    parent: Node,
    templateStart: number,
): Node | undefined {
    if (child.getStart() < templateStart) return undefined
    if (isIfStatement(parent))
        return parent.expression === child && isParenthesizedExpression(child)
            ? child
            : undefined
    if (isExpressionStatement(child))
        return isParenthesizedExpression(child.expression) ? child : undefined
    // `const __subjectN = (…)`, the `{#for}` subject — and no declaration an arm's `<script>` makes,
    // which tracks nothing (14.8).
    if (!isVariableStatement(child)) return undefined
    const declared = child.declarationList.declarations[0]?.name
    return declared !== undefined &&
        isIdentifier(declared) &&
        declared.text.startsWith(SUBJECT)
        ? child
        : undefined
}

// Every `await` a body runs itself, a nested function's aside. Asked once per body.
const AWAITS = new WeakMap<Node, number[]>()

function awaitsIn(body: Node): number[] {
    let found = AWAITS.get(body)
    if (found !== undefined) return found
    found = []
    const list = found
    const visit = (node: Node): void => {
        if (node !== body && FUNCTIONS.has(node.kind)) return
        if (isAwaitExpression(node)) list.push(node.getStart())
        if (isForOfStatement(node) && node.awaitModifier !== undefined)
            list.push(node.getStart())
        node.forEachChild((child) => {
            visit(child)
            return undefined
        })
    }
    visit(body)
    AWAITS.set(body, found)
    return found
}

// `reads` is every reactive read in the file: where it starts, and the name it reads.
export function trackingWarnings(
    read: Node,
    name: string,
    templateStart: number,
    reads: readonly { start: number; name: string }[],
): Warning[] {
    const created: Node[] = []
    let decides: { condition: Node; within: Node } | undefined
    let body: Body | undefined
    let child: Node = read
    // THE NEAREST TEMPLATE POSITION with no function between it and the file. An arm and a row are
    // projected inside the `if` and the `for` they are, so a position is not only found at the top —
    // and one under a created function is that function's statement rather than a position.
    let position: Node | undefined
    for (let node = read.parent; node !== undefined; node = node.parent) {
        if (
            created.length === 0 &&
            decides === undefined &&
            isCondition(child, node)
        )
            decides = { condition: child, within: node }
        if (FUNCTIONS.has(node.kind)) {
            const kind = trackedKind(node)
            if (kind !== undefined) {
                body = { node, kind }
                break
            }
            created.push(node)
            position = undefined
        } else if (node.kind === SyntaxKind.SourceFile) {
            if (position !== undefined)
                body = { node: position, kind: 'template' }
            break
        } else if (position === undefined)
            position = templateBody(child, node, templateStart)
        child = node
    }
    if (body === undefined) return []
    const warnings: Warning[] = []
    const at = read.getStart()
    // 14.16 — a function the body creates and hands to something that runs it later.
    for (const fn of created)
        if (!runsSynchronously(fn)) {
            warnings.push({
                at,
                message: `abide: \`${name}\` is read inside a function this tracked body creates and does not call as it runs, so nothing tracks the read and a change to \`${name}\` will not rerun the body. Read it in the body and close over the value. RULEBOOK 14.16.`,
            })
            return warnings
        }
    // 14.14 — past an `await`, the body has returned to whatever tracked it.
    for (const awaited of awaitsIn(body.node))
        if (awaited < at) {
            warnings.push({
                at,
                message: `abide: \`${name}\` is read after an \`await\` in a tracked body, and tracking ends at the first \`await\`, so a change to \`${name}\` will not rerun the body. Read it before the \`await\`. RULEBOOK 14.14.`,
            })
            break
        }
    // 14.15 — what a condition decides is which other values the body reads, so they differ run
    // to run and each run re-subscribes them.
    if (
        decides !== undefined &&
        body.kind === 'reactive' &&
        decidesARead(decides.condition, decides.within, name, reads)
    )
        warnings.push({
            at,
            message: `abide: \`${name}\` decides a condition in a reactive body, so which values the body reads changes from run to run, and every change re-subscribes them. Read what both branches need before deciding. RULEBOOK 14.15.`,
        })
    return warnings
}

// Whether a read of ANOTHER value stands in what the condition decides — the rest of the statement
// or expression it conditions — which is the only case where the body's sources can change. The
// condition's own value read again in a branch is read on every run either way.
function decidesARead(
    condition: Node,
    within: Node,
    name: string,
    reads: readonly { start: number; name: string }[],
): boolean {
    const from = within.getStart()
    const to = within.end
    const skipFrom = condition.getStart()
    const skipTo = condition.end
    for (const read of reads) {
        const at = read.start
        if (
            read.name !== name &&
            at >= from &&
            at < to &&
            (at < skipFrom || at >= skipTo)
        )
            return true
    }
    return false
}
