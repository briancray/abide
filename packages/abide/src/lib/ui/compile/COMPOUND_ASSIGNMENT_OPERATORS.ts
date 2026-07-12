import ts from 'typescript'

/*
Maps a compound-assignment operator to its plain binary counterpart, for lowering
`x += y` into an unconditional read-combine-write. Logical assignments
(`||=`/`&&=`/`??=`) lower the same way — the patch/cell write always fires,
consistent with how `+=` lowers. Shared by lowerDocAccess (the `$$model` write path)
and renameSignalRefs (the `$$writeCell` linked-cell path) so the two lowerings can't
drift.
*/
export const COMPOUND_ASSIGNMENT_OPERATORS = new Map<ts.SyntaxKind, ts.BinaryOperator>([
    [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.PlusToken],
    [ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.MinusToken],
    [ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.AsteriskToken],
    [ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.SlashToken],
    [ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.BarBarToken],
    [ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken],
    [ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.QuestionQuestionToken],
])
