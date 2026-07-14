import ts from 'typescript'

/* Arithmetic compound assignments → their plain binary counterpart, lowered to a
   read-combine-write (`x += y` → `write(read + y)`). */
const ARITHMETIC_COMPOUND_OPERATORS = new Map<ts.SyntaxKind, ts.BinaryOperator>([
    [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.PlusToken],
    [ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.MinusToken],
    [ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskToken],
    [ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.SlashToken],
])

/* Logical compound assignments SHORT-CIRCUIT: the write fires only when the guard
   passes (`x ??= v` is `x ?? (x = v)`), so they lower to `read <op> write(right)`, NOT
   an unconditional write — matching JS, so a non-nullish/truthy/falsy guard does no
   needless patch or cell reseed. */
const LOGICAL_ASSIGNMENT_OPERATORS = new Map<ts.SyntaxKind, ts.BinaryOperator>([
    [ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.QuestionQuestionToken],
    [ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.BarBarToken],
    [ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken],
])

/*
Lowers an assignment (`=`, arithmetic `+=`, or logical `??=`/`||=`/`&&=`) to a reactive
write, shared by the `$$model` doc path (lowerDocAccess) and the `$$writeCell` linked-cell
path (renameSignalRefs) so the two lowerings can't drift. `makeRead` builds the target's
read expression (only called for compound operators); `makeWrite` wraps a value in the
write call. Returns undefined for an operator this doesn't handle so the caller can leave
the node untouched. The write must evaluate to the written value (see `Cell.set` /
`Doc.replace`) for the logical short-circuit to yield the right result.
*/
export function lowerCompoundAssignment(
    operator: ts.SyntaxKind,
    makeRead: () => ts.Expression,
    right: ts.Expression,
    makeWrite: (value: ts.Expression) => ts.Expression,
): ts.Expression | undefined {
    if (operator === ts.SyntaxKind.EqualsToken) {
        return makeWrite(right)
    }
    const arithmetic = ARITHMETIC_COMPOUND_OPERATORS.get(operator)
    if (arithmetic !== undefined) {
        return makeWrite(ts.factory.createBinaryExpression(makeRead(), arithmetic, right))
    }
    const logical = LOGICAL_ASSIGNMENT_OPERATORS.get(operator)
    if (logical !== undefined) {
        return ts.factory.createBinaryExpression(makeRead(), logical, makeWrite(right))
    }
    return undefined
}
