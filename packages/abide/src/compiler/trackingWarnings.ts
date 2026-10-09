import { type Node, SyntaxKind } from 'typescript/unstable/ast'
import {
    isArrowFunction,
    isAwaitExpression,
    isBinaryExpression,
    isCallExpression,
    isConditionalExpression,
    isDoStatement,
    isForOfStatement,
    isForStatement,
    isFunctionExpression,
    isIdentifier,
    isIfStatement,
    isPropertyAccessExpression,
    isWhileStatement,
} from 'typescript/unstable/ast/is'
import { FUNCTIONS, TRANSPARENT } from './classifyRead.ts'
import type { Finding } from './Finding.ts'
import type { PositionKind, PositionTable } from './PositionTable.ts'

// 14.14, 14.15, 14.16 — WHERE A READ STANDS IN A BODY THAT TRACKS, and the three ways it can stand
// there and not do what it looks like doing. Read off the checker's own tree of the projection, so a
// position here is a projection offset. Each is a warning rather than a refusal: the program is
// valid, and a read that is not tracked is sometimes what was meant.
//
// A TRACKED BODY is an unkeyed `reactive` body (14.3), a `watch` effect (14.6), or a template
// position (14.2) of a kind in `TRACKED`.

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

/**
 * 14.2 — the template positions that track: what the template renders, tests or iterates, and what
 * a component is handed, which the child reads where it tracks. Not a listener or an element's
 * `bind:` (14.9), a branch-local `<script>` (14.8), an inline component's head (14.7), or a value
 * the shadow types as `any`.
 */
const TRACKED: ReadonlySet<PositionKind> = new Set([
    'slot',
    'attribute',
    'condition',
    'subject',
    'key',
    'prop',
    'componentBind',
    'tag',
])

/** `node` past any `TRANSPARENT` wrapper around it, and what holds it. */
function holderOf(node: Node): { child: Node; parent: Node } {
    let child = node
    while (TRANSPARENT.has(child.parent.kind)) child = child.parent
    return { child, parent: child.parent }
}

/** The name a call's callee spells — `f` in `f()` and in `x.f()` — or `undefined`. */
function calleeName(call: Node): string | undefined {
    if (!isCallExpression(call)) return undefined
    const callee = call.expression
    if (isIdentifier(callee)) return callee.text
    if (isPropertyAccessExpression(callee) && isIdentifier(callee.name))
        return callee.name.text
    return undefined
}

/** Which kind of tracked body a function is, or `undefined` where it is none. */
function trackedKind(functionNode: Node): Body['kind'] | undefined {
    if (!isArrowFunction(functionNode) && !isFunctionExpression(functionNode))
        return undefined
    const { child, parent } = holderOf(functionNode)
    if (!isCallExpression(parent) || parent.arguments[0] !== child)
        return undefined
    const name = calleeName(parent)
    // 14.4 — a body declaring a parameter is keyed, and does not track.
    if (name === 'reactive' && functionNode.parameters.length === 0)
        return 'reactive'
    if (name === 'watch') return 'watch'
    return undefined
}

/** Whether a function a tracked body creates runs before the body returns. */
function runsSynchronously(
    functionNode: Node,
    positions: PositionTable,
): boolean {
    const { child, parent } = holderOf(functionNode)
    // 14.18 — A COMPONENT'S `bind:` PAIR (32.6) is not kept for later: the child calls `get` inside a body
    // that tracks, and `set` where it writes, so a read in either is where it should be.
    const member =
        parent.kind === SyntaxKind.PropertyAssignment ? parent : child
    if (
        member.parent.kind === SyntaxKind.ObjectLiteralExpression &&
        positions.of(holderOf(member.parent).child)?.kind === 'componentBind'
    )
        return true
    if (!isCallExpression(parent)) return false
    if (parent.expression === child) return true
    const name = calleeName(parent)
    return name !== undefined && SYNCHRONOUS.has(name)
}

/** Whether `child` is the condition of `parent`, which decides what else runs. */
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

// Every `await` a body runs itself, a nested function's aside. Asked once per body.
const AWAITS = new WeakMap<Node, number[]>()

/**
 * Where each `await` a body runs itself suspends, memoized in `AWAITS`.
 *
 * AT THE END OF WHAT IT AWAITS, not at the keyword: the operand is evaluated before the body
 * suspends, so `id` in `await call({ id })` is read while the body still tracks — where `c` in
 * `await a(b) + c` is not. A `for await` suspends once its iterable is evaluated.
 */
function awaitsIn(body: Node): number[] {
    let found = AWAITS.get(body)
    if (found !== undefined) return found
    found = []
    const list = found
    const visit = (node: Node): void => {
        if (node !== body && FUNCTIONS.has(node.kind)) return
        if (isAwaitExpression(node)) list.push(node.expression.end)
        if (isForOfStatement(node) && node.awaitModifier !== undefined)
            list.push(node.expression.end)
        node.forEachChild((child) => {
            visit(child)
            return undefined
        })
    }
    visit(body)
    AWAITS.set(body, found)
    return found
}

/**
 * Why a read in a tracked body may not track: the 14.14, 14.15 and 14.16 warnings for one read.
 *
 * `reads` is every reactive read in the file: where it starts, and the name it reads.
 */
export function trackingWarnings(
    read: Node,
    name: string,
    positions: PositionTable,
    reads: readonly { start: number; name: string }[],
): Finding[] {
    const created: Node[] = []
    let decides: { condition: Node; within: Node } | undefined
    let body: Body | undefined
    let child: Node = read
    // THE TEMPLATE POSITION the read stands in, wherever the projection put it: an arm, a row and
    // an inline component's body are projected inside the `if`, the `for` and the function they are.
    for (let node = read.parent; node !== undefined; node = node.parent) {
        const position = positions.of(child)
        if (position !== undefined) {
            if (TRACKED.has(position.kind))
                body = { node: child, kind: 'template' }
            break
        }
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
        }
        child = node
    }
    if (body === undefined) return []
    const warnings: Finding[] = []
    const at = read.getStart()
    // 14.16 — a function the body creates and hands to something that runs it later.
    for (const functionNode of created)
        if (!runsSynchronously(functionNode, positions)) {
            warnings.push({
                at,
                message: `abide: \`${name}\` is read inside a function this tracked body creates and does not call as it runs, so nothing tracks the read and a change to \`${name}\` will not rerun the body. Read it in the body and close over the value. RULEBOOK 14.16.`,
            })
            return warnings
        }
    // 14.14 — past an `await`, the body has returned to whatever tracked it.
    for (const suspends of awaitsIn(body.node))
        if (suspends <= at) {
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

/**
 * Whether a read of ANOTHER value stands in what the condition decides.
 *
 * What it decides is the rest of the statement or expression it conditions — which is the only
 * case where the body's sources can change. The condition's own value read again in a branch is
 * read on every run either way.
 */
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
