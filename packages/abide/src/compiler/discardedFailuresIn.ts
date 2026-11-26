import type { Node } from 'typescript/unstable/ast'
import {
    isAwaitExpression,
    isCallExpression,
    isExpressionStatement,
    isParenthesizedExpression,
    isTypeAliasDeclaration,
} from 'typescript/unstable/ast/is'
import type {
    Checker,
    Project,
    Symbol as CheckedSymbol,
} from 'typescript/unstable/async'

import type { Finding } from './Diagnostics.ts'
import { FRAMEWORK_SOURCES } from './FRAMEWORK_SOURCES.ts'

// 15.10 — A REFUSAL BUILT AND DROPPED. `refuse` hands its `Failed` back rather than throwing it (15.4),
// so one written as a statement is answered by nothing: the run goes on past it as though the check
// it stood for had passed. Asked of every statement that is a call, awaited or not — the one shape a
// `Failed` is made and left in — and of no other expression, so a file pays a round-trip per such
// statement and none per read.

const MESSAGE =
    "abide: this statement makes a refusal and drops it — refuse() hands back a Failed rather than throwing, so nothing is refused and the code after it runs. Return it, or throw it where the caller's rejection is the refusal. RULEBOOK 15.10."

/** 15.10 — abide's `Failed` alias, as the checker names it, or `undefined` where the program has none. */
export async function failedAliasIn(
    project: Project,
): Promise<CheckedSymbol | undefined> {
    const file = await project.program.getSourceFile(FRAMEWORK_SOURCES.failed)
    for (const statement of file?.statements ?? [])
        if (
            isTypeAliasDeclaration(statement) &&
            statement.name.text === 'Failed'
        )
            return project.checker.getSymbolAtLocation(statement.name)
    return undefined
}

/** 15.10 — each statement in `sourceFile` whose value is a `Failed` nothing takes. */
export async function discardedFailuresIn(
    checker: Checker,
    sourceFile: Node,
    failed: CheckedSymbol,
): Promise<Finding[]> {
    const calls: Node[] = []
    const visit = (node: Node): void => {
        if (isExpressionStatement(node)) {
            // The statement's own value is asked — an awaited call's is what it settles to.
            let asked: Node = node.expression
            while (isParenthesizedExpression(asked)) asked = asked.expression
            let called: Node = asked
            while (
                isParenthesizedExpression(called) ||
                isAwaitExpression(called)
            )
                called = called.expression
            if (isCallExpression(called)) calls.push(asked)
        }
        node.forEachChild((child) => {
            visit(child)
            return undefined
        })
    }
    visit(sourceFile)
    const found: Finding[] = []
    for (const call of calls) {
        const type = await checker.getTypeAtLocation(call)
        if ((await type?.getAliasSymbol())?.id === failed.id)
            found.push({ at: call.getStart(), message: MESSAGE })
    }
    return found
}
