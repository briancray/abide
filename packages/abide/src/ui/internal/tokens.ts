// THE TOKEN LAYER — one flat token stream over a `<script>` body, plus the bracket analysis every
// consumer of it needs.
//
// Split out of `analyzeBindings` because it is not about bindings at all: `tokenize`/`tokenAt`/
// `analyzeBraces`/`rhsExtent` know nothing about cells, memos, props or scopes, and two separate
// consumers sit on top of them — the binding + shadow analysis, and the type-position recognizer
// (`typePositions.ts`), which is a pure `Tok[] -> Set<number>` with zero binding coupling. Keeping the
// three in one 2400-line file meant the recognizer's twelve branches could only be reached through a
// string-in/string-out rewrite.

import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'
import { CONTINUATION_OPERATORS } from './CONTINUATION_OPERATORS.ts'

export const K = SyntaxKind

// ---------------------------------------------------------------------------

export interface Tok {
    kind: SyntaxKind
    start: number
    end: number
    text: string
    nl: boolean // preceding line break (for ASI-style statement boundaries)
}

// The raw scanner does not track template nesting, so after the `}` that closes a `${…}` substitution
// it would mis-lex the following literal text as code. We drive `reScanTemplateToken` ourselves using a
// small frame stack: a `${` (TemplateHead) opens a template frame; the matching `}` re-scans into a
// TemplateMiddle (another substitution follows) or TemplateTail (template ends).
export function tokenize(source: string): Tok[] {
    const scanner = createScanner(true, /* Standard */ 0, source)
    const tokens: Tok[] = []
    const frames: ('template' | 'brace')[] = []
    for (;;) {
        let kind = scanner.scan()
        if (kind === K.EndOfFile) break
        if (kind === K.CloseBraceToken && frames[frames.length - 1] === 'template') {
            kind = scanner.reScanTemplateToken(false)
            if (kind === K.TemplateTail) frames.pop()
            // TemplateMiddle: another substitution follows — keep the template frame.
        } else if (kind === K.TemplateHead) {
            frames.push('template')
        } else if (kind === K.OpenBraceToken) {
            frames.push('brace')
        } else if (kind === K.CloseBraceToken) {
            frames.pop()
        }
        tokens.push({
            kind,
            start: scanner.getTokenStart(),
            end: scanner.getTokenEnd(),
            text: scanner.getTokenText(),
            nl: scanner.hasPrecedingLineBreak(),
        })
    }
    return tokens
}

export function isOpen(kind: SyntaxKind): boolean {
    return kind === K.OpenParenToken || kind === K.OpenBracketToken || kind === K.OpenBraceToken
}

export function isClose(kind: SyntaxKind): boolean {
    return kind === K.CloseParenToken || kind === K.CloseBracketToken || kind === K.CloseBraceToken
}

// Index into a token array at a position that is provably in range (a bounded loop counter or a
// matched-bracket index). Throws instead of returning a silent `undefined`, preserving the
// crash-on-out-of-range semantics the previous `tokenAt(tokens, i)` assertions carried.
export function tokenAt(tokens: Tok[], index: number): Tok {
    const token = tokens[index]
    if (token === undefined) throw new Error(`analyzeBindings: token index out of range: ${index}`)
    return token
}

// As `tokenAt`, for the parallel numeric analysis arrays (`enclBraceOpen`, `bracketDepth`) whose
// length matches the token stream so an in-range token index is always in range here too.
// Index into a number array that TS types as possibly-undefined under `noUncheckedIndexedAccess`.
// A token-layer helper: both the binding analysis and the type-position recognizer index the same
// brace/bracket arrays.
export function numberAt(values: number[], index: number): number {
    const value = values[index]
    if (value === undefined) throw new Error(`analyzeBindings: array index out of range: ${index}`)
    return value
}

// ---------------------------------------------------------------------------
// Token-kind classification sets
// ---------------------------------------------------------------------------

// After one of these tokens, a following `{` opens an OBJECT LITERAL (value/expression position). Any
// other predecessor (identifier, `)`, `]`, `}`, `;`, `=>`, `else`/`do`/`try`, or start) → a block.
const PRECEDE_OBJECT: Set<SyntaxKind> = new Set([
    K.OpenParenToken,
    K.OpenBracketToken,
    K.CommaToken,
    K.ColonToken,
    K.QuestionToken,
    K.ExclamationToken,
    K.TildeToken,
    K.DotDotDotToken,
    K.EqualsToken,
    K.PlusEqualsToken,
    K.MinusEqualsToken,
    K.AsteriskEqualsToken,
    K.SlashEqualsToken,
    K.PercentEqualsToken,
    K.AsteriskAsteriskEqualsToken,
    K.AmpersandEqualsToken,
    K.BarEqualsToken,
    K.CaretEqualsToken,
    K.LessThanLessThanEqualsToken,
    K.GreaterThanGreaterThanEqualsToken,
    K.GreaterThanGreaterThanGreaterThanEqualsToken,
    K.AmpersandAmpersandEqualsToken,
    K.BarBarEqualsToken,
    K.QuestionQuestionEqualsToken,
    K.PlusToken,
    K.MinusToken,
    K.AsteriskToken,
    K.SlashToken,
    K.PercentToken,
    K.AsteriskAsteriskToken,
    K.AmpersandToken,
    K.BarToken,
    K.CaretToken,
    K.LessThanToken,
    K.GreaterThanToken,
    K.LessThanEqualsToken,
    K.GreaterThanEqualsToken,
    K.EqualsEqualsToken,
    K.EqualsEqualsEqualsToken,
    K.ExclamationEqualsToken,
    K.ExclamationEqualsEqualsToken,
    K.AmpersandAmpersandToken,
    K.BarBarToken,
    K.QuestionQuestionToken,
    K.LessThanLessThanToken,
    K.GreaterThanGreaterThanToken,
    K.GreaterThanGreaterThanGreaterThanToken,
    K.ReturnKeyword,
    K.TypeOfKeyword,
    K.VoidKeyword,
    K.DeleteKeyword,
    K.InKeyword,
    K.InstanceOfKeyword,
    K.NewKeyword,
    K.AwaitKeyword,
    K.YieldKeyword,
    K.CaseKeyword,
])

// TS *contextual* keywords the scanner tokenises as their own keyword kind (not `Identifier`) even
// though they are legal VALUE identifiers with no operator meaning in expression position — e.g. a
// template that refers to a binding literally named `type`, `accessor`, `object`, or `module` (TODO
// #18). Without this, a bare such reference is skipped by the free-identifier passes → never rewritten
// to `$scope.<name>` → `ReferenceError` at mount. This is an ALLOWLIST on purpose: the DANGEROUS
// contextual keywords that DO carry expression/operator/declaration meaning — `await`, `async`, `as`,
// `satisfies`, `of`, `yield`, `get`/`set` (accessors), `using`, `assert(s)`, `keyof`, `infer`, `is` —
// are deliberately EXCLUDED so we never misread `{await fn()}`, `x as T`, `for (a of b)`, `{ get x(){} }`
// as identifier references. Missing a safe one only leaves the (rare) bug in place; wrongly including a
// dangerous one would break real template syntax — so the set errs small.
const SAFE_VALUE_KEYWORDS: Set<SyntaxKind> = new Set([
    K.AbstractKeyword,
    K.AccessorKeyword,
    K.AnyKeyword,
    K.BooleanKeyword,
    K.DeclareKeyword,
    K.IntrinsicKeyword,
    K.ModuleKeyword,
    K.NamespaceKeyword,
    K.NeverKeyword,
    K.OutKeyword,
    K.ReadonlyKeyword,
    K.RequireKeyword,
    K.NumberKeyword,
    K.ObjectKeyword,
    K.StringKeyword,
    K.SymbolKeyword,
    K.TypeKeyword,
    K.UniqueKeyword,
    K.UnknownKeyword,
    K.FromKeyword,
    K.GlobalKeyword,
    K.BigIntKeyword,
    K.OverrideKeyword,
])

// A token usable as a value IDENTIFIER: a real `Identifier`, or one of the allowlisted contextual
// keywords above. Used by the binding collectors + free-identifier passes so a keyword-named binding
// is bound/shadowed correctly AND a keyword-named free reference is rewritten to `$scope.<name>`.
export function isIdentifierLike(kind: SyntaxKind): boolean {
    return kind === K.Identifier || SAFE_VALUE_KEYWORDS.has(kind)
}

// ---------------------------------------------------------------------------
// Bracket matching + object-literal / depth classification (pure array pass)
// ---------------------------------------------------------------------------

export interface BraceInfo {
    matchClose: Map<number, number> // open token index → close token index
    matchOpen: Map<number, number> // close token index → open token index
    enclBraceOpen: number[] // per token: index of nearest enclosing `{` (brace only), or -1
    isObjectBrace: Set<number> // `{` open-token indices classified as object literals
    bracketDepth: number[] // per token: enclosing bracket depth (all of (), [], {})
}

export function analyzeBraces(tokens: Tok[]): BraceInfo {
    const n = tokens.length
    const matchClose = new Map<number, number>()
    const matchOpen = new Map<number, number>()
    const openStack: number[] = []
    for (let i = 0; i < n; i++) {
        const kind = tokenAt(tokens, i).kind
        if (isOpen(kind)) openStack.push(i)
        else if (isClose(kind)) {
            const open = openStack.pop()
            if (open !== undefined) {
                matchClose.set(open, i)
                matchOpen.set(i, open)
            }
        }
    }

    const enclBraceOpen: number[] = new Array(n).fill(-1)
    const braceStack: number[] = []
    for (let i = 0; i < n; i++) {
        const kind = tokenAt(tokens, i).kind
        if (kind === K.CloseBraceToken) braceStack.pop()
        enclBraceOpen[i] = braceStack.at(-1) ?? -1
        if (kind === K.OpenBraceToken) braceStack.push(i)
    }

    const bracketDepth: number[] = new Array(n).fill(0)
    let depth = 0
    for (let i = 0; i < n; i++) {
        const kind = tokenAt(tokens, i).kind
        if (isClose(kind)) {
            depth--
            bracketDepth[i] = depth
        } else {
            bracketDepth[i] = depth
            if (isOpen(kind)) depth++
        }
    }

    const isObjectBrace = new Set<number>()
    for (let i = 0; i < n; i++) {
        if (tokenAt(tokens, i).kind === K.OpenBraceToken) {
            const prev = i > 0 ? tokenAt(tokens, i - 1).kind : undefined
            if (prev === undefined || PRECEDE_OBJECT.has(prev)) isObjectBrace.add(i)
        }
    }

    return { matchClose, matchOpen, enclBraceOpen, isObjectBrace, bracketDepth }
}

// Extent of an assignment/compound RHS starting at token `start`; returns the last RHS token index.
// Stops at a depth-0 comma/semicolon, an enclosing bracket close, or a statement-boundary line break.
export function rhsExtent(tokens: Tok[], start: number): number {
    let depth = 0
    let last = start
    for (let j = start; j < tokens.length; j++) {
        const t = tokenAt(tokens, j)
        const kind = t.kind
        if (depth === 0) {
            if (kind === K.CommaToken || kind === K.SemicolonToken) return j > start ? j - 1 : start
            // A line break is a statement boundary ONLY when neither side is a continuation operator —
            // otherwise the expression continues onto the next line (JS ASI), so keep scanning.
            if (
                t.nl &&
                j > start &&
                !CONTINUATION_OPERATORS.afterPrev.has(tokenAt(tokens, j - 1).kind) &&
                !CONTINUATION_OPERATORS.atNext.has(kind)
            )
                return j - 1
        }
        if (isOpen(kind)) depth++
        else if (isClose(kind)) {
            if (depth === 0) return j > start ? j - 1 : start
            depth--
        }
        last = j
    }
    return last
}
