import ts from 'typescript'

/*
Lowers `x++` / `++x` / `x--` / `--x` on reactive state to a write of the stepped value,
shared by the `$$model` doc path (lowerDocAccess) and the `$$writeCell` linked-cell path
(renameSignalRefs). `makeRead`/`makeWrite` mirror `lowerCompoundAssignment`. The bare `++`
can't survive onto the read form (`$$readCell(x)` / `$$model.read(...)` are calls, not
lvalues), so it becomes an explicit write of `read ± 1`.

Prefix evaluates to the NEW value, which is exactly what the write returns, so
`write(read ± 1)` is correct as-is. POSTFIX must evaluate to the PREVIOUS value, so its
result is corrected back by the opposite step (`x++` → `write(read + 1) - 1`) — no temp or
closure, since the write returns the written value (`Cell.set` / `Doc.replace`). The
correction is dead when the value is discarded (a statement `x++;`), so it costs nothing
there.
*/
export function lowerUpdateExpression(
    isPostfix: boolean,
    isIncrement: boolean,
    makeRead: () => ts.Expression,
    makeWrite: (value: ts.Expression) => ts.Expression,
): ts.Expression {
    const step = isIncrement ? ts.SyntaxKind.PlusToken : ts.SyntaxKind.MinusToken
    const write = makeWrite(
        ts.factory.createBinaryExpression(makeRead(), step, ts.factory.createNumericLiteral(1)),
    )
    if (!isPostfix) {
        return write
    }
    const correction = isIncrement ? ts.SyntaxKind.MinusToken : ts.SyntaxKind.PlusToken
    return ts.factory.createBinaryExpression(write, correction, ts.factory.createNumericLiteral(1))
}
