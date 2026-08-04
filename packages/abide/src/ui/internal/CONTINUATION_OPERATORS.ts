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
//
// The template kinds are the sharpest case of that asymmetry, and each of the three sits in a
// DIFFERENT role. Only `TemplateMiddle` is symmetric: `}…${` both completes an operand and opens
// another, so it dangles in either direction. `TemplateHead` (`` `a ${ ``) dangles
// only FORWARD — the substitution expression is still owed — and `TemplateTail` (`` }` ``) only
// BACKWARD, since it closes the literal and the expression is finished. `TemplateTail` in `afterPrev`
// meant a line ending in one never ended the RHS, so
//
//     msg = `a ${b}`
//     const after = 1
//
// put the `.set(…)`'s closing paren after `const after = 1` instead of after the literal: the RHS ran
// on to the next comma, closing bracket or EOF, swallowing every following statement into the call.
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
]

// TOKENS THAT CONTINUE A VALUE AND COMPLETE A TYPE. The sets above are value-expression rules, and a
// `<script>` scan applies them at positions that are sometimes TYPE positions — where the same token
// means the opposite thing:
//
//   `void`  — a prefix operator in a value (`void 0`), a complete type in an annotation (`() => void`).
//   `>`     — a comparison in a value (`a >\n b`), the close of a type-argument list (`Array<string>`).
//
// Applying the value rule inside a type is how a declaration ran past its own line break and absorbed
// the NEXT statement: `let onReset: () => void` never ended, so `let count = state(0)` was swallowed
// into its declarator text and `count` was neither a binding nor a cell — `{count}` rendered empty and
// `count = 5` was never lowered to a `.set()`. Silently, and green under `abide check`, which shares
// this scanner. Same shape in `typePositions`' `type X = …` alias, where the run-on instead marked the
// following statement's identifiers as type positions and left every cell reference un-rewritten.
export const TYPE_TERMINALS: ReadonlySet<SyntaxKind> = new Set<SyntaxKind>([
    SyntaxKind.VoidKeyword,
    SyntaxKind.GreaterThanToken,
])

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
        SyntaxKind.TemplateHead,
    ]),
    // A line whose NEXT token is one of these continues the previous line (a call / index / member /
    // operator tail). Statements never BEGIN with these, so treating them as continuation cannot
    // swallow a genuinely separate statement.
    atNext: new Set<SyntaxKind>([
        ...BOTH_ROLES,
        SyntaxKind.OpenParenToken,
        SyntaxKind.OpenBracketToken,
        SyntaxKind.TemplateTail,
    ]),
} as const
