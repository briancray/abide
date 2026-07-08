import ts from 'typescript'

/*
Collects every identifier NAME that is written somewhere in `source` — the target of
an assignment (`x = …`, `x += …`, and every compound form) or the operand of a `++`/`--`
update. A write to a member (`x.foo = …`, `x[i]++`) counts as a write to its root object
identifier (`x`), since mutating the object the prop holds still needs a writable cell.
Reads never count. Used to decide which props a component actually writes, so only those
are upgraded from a read-only derive to a writable cell (`bindableProp`).

Accumulates into `into` so several fragments (the script, each template expression) can
feed one set. Best-effort and syntactic — it does not resolve scope, so a shadowing local
of the same name is conservatively treated as a write to the prop; that only ever upgrades
a prop needlessly, never drops a real write.
*/
export function assignmentTargetNames(source: ts.SourceFile, into: Set<string>): void {
    const rootIdentifier = (node: ts.Expression): string | undefined => {
        let current: ts.Expression = node
        /* Peel member/element access and parens down to the base object identifier — every
           one of these node kinds exposes the inner expression as `.expression`. */
        while (
            ts.isPropertyAccessExpression(current) ||
            ts.isElementAccessExpression(current) ||
            ts.isParenthesizedExpression(current) ||
            ts.isNonNullExpression(current)
        ) {
            current = current.expression
        }
        return ts.isIdentifier(current) ? current.text : undefined
    }
    const visit = (node: ts.Node): void => {
        if (
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
            const name = rootIdentifier(node.left)
            if (name !== undefined) {
                into.add(name)
            }
        } else if (
            (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
            (node.operator === ts.SyntaxKind.PlusPlusToken ||
                node.operator === ts.SyntaxKind.MinusMinusToken)
        ) {
            const name = rootIdentifier(node.operand as ts.Expression)
            if (name !== undefined) {
                into.add(name)
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(source)
}
