import { SyntaxKind } from 'typescript/unstable/ast'

// Where JS never applies ASI. A depth-0 line break inside a `<script>` ends a statement (or an
// assignment RHS, or a declarator initializer) only when NEITHER the token before it nor the token
// after it is a continuation — otherwise the expression carries onto the next line and severing it
// emits code that is a syntax error in TS but not in `.abide`.
//
// This is the SINGLE source for both compiler lanes. It was two: `analyzeBindings` (the build lane)
// and `emitCheck` (the check/LSP lane) each declared a set named `CONTINUATION_OPERATORS`, and they
// drifted — the check lane learned about `? :`, `as`, `instanceof`, `in`, `satisfies` and template
// continuations; the build lane never did. The consequence was not a check-lane false positive but
// WRONG EMITTED CODE from the build lane: `rhsExtent` truncated at the line break, so
//
//     n = cond
//       ? a
//       : b
//
// emitted `n.set( cond)` followed by an orphaned ternary — which compiles, sets the cell to `cond`,
// and evaluates a ternary on the discarded result. A duplicated rule fixed on one copy is the shape
// this whole namespace of constants (HTML_ANCHOR, SHORTHAND_OBJECT_PATTERN, RPC_QUERY_PARAMS) exists
// to prevent; this one was simply missed.
//
// The split is by ROLE, not one symmetric set: a leading `(`/`[` continues a line only as a call or
// index tail, and the prefix keywords (`new`, `typeof`, `await`, …) only as a dangling operand. The
// build lane used to apply one symmetric set in both roles, which is why the direction-specific
// members had nowhere to live.
const BOTH_ROLES: readonly SyntaxKind[] = [
    SyntaxKind.DotToken,
    SyntaxKind.QuestionDotToken,
    SyntaxKind.QuestionToken,
    SyntaxKind.ColonToken,
    SyntaxKind.CommaToken,
    SyntaxKind.PlusToken,
    SyntaxKind.MinusToken,
    SyntaxKind.AsteriskToken,
    SyntaxKind.AsteriskAsteriskToken,
    SyntaxKind.SlashToken,
    SyntaxKind.PercentToken,
    SyntaxKind.AmpersandAmpersandToken,
    SyntaxKind.BarBarToken,
    SyntaxKind.QuestionQuestionToken,
    SyntaxKind.LessThanToken,
    SyntaxKind.GreaterThanToken,
    SyntaxKind.LessThanEqualsToken,
    SyntaxKind.GreaterThanEqualsToken,
    SyntaxKind.EqualsEqualsToken,
    SyntaxKind.ExclamationEqualsToken,
    SyntaxKind.EqualsEqualsEqualsToken,
    SyntaxKind.ExclamationEqualsEqualsToken,
    SyntaxKind.AmpersandToken,
    SyntaxKind.BarToken,
    SyntaxKind.CaretToken,
    SyntaxKind.EqualsToken,
    SyntaxKind.EqualsGreaterThanToken,
    SyntaxKind.InKeyword,
    SyntaxKind.InstanceOfKeyword,
    SyntaxKind.AsKeyword,
    SyntaxKind.SatisfiesKeyword,
    SyntaxKind.TemplateMiddle,
    SyntaxKind.TemplateTail,
]

export const CONTINUATION_OPERATORS = {
    // A line whose PREVIOUS token is one of these has a dangling operand the next line supplies.
    afterPrev: new Set<SyntaxKind>([
        ...BOTH_ROLES,
        SyntaxKind.NewKeyword,
        SyntaxKind.TypeOfKeyword,
        SyntaxKind.VoidKeyword,
        SyntaxKind.AwaitKeyword,
        SyntaxKind.YieldKeyword,
        SyntaxKind.DeleteKeyword,
        SyntaxKind.KeyOfKeyword,
    ]),
    // A line whose NEXT token is one of these continues the previous line (a call / index / member /
    // operator tail). Statements never BEGIN with these, so treating them as continuation cannot
    // swallow a genuinely separate statement.
    atNext: new Set<SyntaxKind>([
        ...BOTH_ROLES,
        SyntaxKind.OpenParenToken,
        SyntaxKind.OpenBracketToken,
    ]),
} as const
