// TYPE-POSITION RECOGNITION — which token indices live in TYPE position rather than value position.
//
// A pure `(Tok[], BraceInfo) -> Set<number>`. It was ~470 lines inside `analyzeBindings` with zero
// coupling to bindings, cells, scopes or shadowing, reachable only through `rewriteCellRefs` /
// `rewriteFreeIdentifiers` as a string-in/string-out rewrite — so of its TWELVE recognizer branches
// (`as`/`satisfies`, a `let|const|var` annotation, `type X<…> =`, `interface`, generic call args, a
// class body, object-literal shorthand methods, a `function` declaration, arrow params, an arrow
// return annotation) only the first had any assertion, and the four hairiest — class body, interface,
// object shorthand method, arrow return annotation, each with its own bail conditions and its own
// `matchClose`/`matchOpen` bookkeeping — had none at all.
//
// The SAFETY INVARIANT below is the thing worth being able to assert rather than merely state.

import type { SyntaxKind } from 'typescript/unstable/ast'
import {
    type BraceInfo,
    isIdentifierLike,
    K,
    numberAt,
    rhsExtent,
    type Tok,
    tokenAt,
} from './tokens.ts'

// ---------------------------------------------------------------------------
// Type-position operand marking (TODO #11 / #18 follow-up)
// ---------------------------------------------------------------------------
//
// `#18` taught the free-identifier passes NOT to misread the OPERATOR keywords `as`/`satisfies`, but
// the type OPERAND that FOLLOWS them (`x as Foo` → `x as $scope.Foo`) was still rewritten — producing
// intermediate TS that is not type-valid. It is harmless at runtime (Bun strips type annotations
// syntactically before resolution, and `emitCheck` is a separate verbatim-copy path), but it is a
// tracked shortcut. `markTypeSkips` walks each `as`/`satisfies` type operand and returns the token
// indices that live in TYPE position, so both free-identifier passes leave them alone.
//
// SAFETY INVARIANT: the scanner only ever ADDS an index it can prove is in type position, and STOPS at
// the first token it cannot classify as type-continuation. It can therefore only ever UNDER-mark
// (leaving today's harmless residue) — it can never mask a real VALUE identifier that must stay
// rewritten (e.g. `a`/`b` in `x as Foo ? a : b`, where the type is just `Foo` and the ternary arms are
// values). Bracketed/scalar atoms only advance the cursor; the recursion never crosses a `?`/`:`/`,`
// or any operator that is not a type-continuation (`|`/`&`).

// Number of `>` a closing-angle token contributes (composite `>>`/`>>>` close nested generics); 0 when
// the token is not a bare closer (e.g. `>=`, `>>=`) → the angle scan bails conservatively.
function greaterArity(kind: SyntaxKind): number {
    if (kind === K.GreaterThanToken) return 1
    if (kind === K.GreaterThanGreaterThanToken) return 2
    if (kind === K.GreaterThanGreaterThanGreaterThanToken) return 3
    return 0
}

// Keyword operators that may LEAD a type (`keyof T`, `readonly T[]`, `infer U`, `typeof x`, `unique
// symbol`, `new () => T`). `typeof`'s operand is a value name but is still type-position (stripped).
const LEADING_TYPE_OPS: Set<SyntaxKind> = new Set([
    K.KeyOfKeyword,
    K.ReadonlyKeyword,
    K.InferKeyword,
    K.TypeOfKeyword,
    K.UniqueKeyword,
    K.NewKeyword,
])

// Non-identifier tokens that stand alone as a type atom (advance-only, nothing to mark): the primitive
// keyword types that DON'T double as value identifiers, plus literal types.
const SCALAR_TYPE_ATOMS: Set<SyntaxKind> = new Set([
    K.VoidKeyword,
    K.NullKeyword,
    K.UndefinedKeyword,
    K.TrueKeyword,
    K.FalseKeyword,
    K.ThisKeyword,
    K.StringLiteral,
    K.NumericLiteral,
    K.BigIntLiteral,
    K.NoSubstitutionTemplateLiteral,
])

// Mark every identifier-like token inside a balanced `(`/`{`/`[` … region as type position. Only called
// on regions already known to be type context (inside an `as`/`satisfies` operand), where identifiers
// are type names / property keys / type params — never runtime values.
function markInner(tokens: Tok[], open: number, close: number, skip: Set<number>): void {
    for (let j = open + 1; j < close; j++) {
        if (isIdentifierLike(tokenAt(tokens, j).kind)) skip.add(j)
    }
}

// Scan a balanced generic argument list `< … >` starting at `openIdx` (a `<`). Returns the index just
// past the matching close, or -1 when it cannot match cleanly (caller then leaves the `<…` unmarked).
function scanAngle(
    tokens: Tok[],
    openIdx: number,
    matchClose: Map<number, number>,
    skip: Set<number>,
): number {
    let depth = 0
    for (let i = openIdx; i < tokens.length; i++) {
        const k = tokenAt(tokens, i).kind
        if (k === K.LessThanToken) {
            depth++
            continue
        }
        const arity = greaterArity(k)
        if (arity > 0) {
            depth -= arity
            if (depth <= 0) return i + 1
            continue
        }
        if (isIdentifierLike(k)) {
            skip.add(i)
            continue
        }
        // Balanced () / [] / {} inside a generic — jump over them (still type context).
        if (k === K.OpenParenToken || k === K.OpenBracketToken || k === K.OpenBraceToken) {
            const close = matchClose.get(i)
            if (close === undefined) return -1
            markInner(tokens, i, close, skip)
            i = close
            continue
        }
        // Structural type tokens legal inside a generic argument (unions, conditionals, function types, …).
        if (
            k === K.DotToken ||
            k === K.CommaToken ||
            k === K.BarToken ||
            k === K.AmpersandToken ||
            k === K.EqualsGreaterThanToken ||
            k === K.QuestionToken ||
            k === K.ColonToken ||
            k === K.ExtendsKeyword ||
            k === K.DotDotDotToken ||
            LEADING_TYPE_OPS.has(k) ||
            SCALAR_TYPE_ATOMS.has(k)
        ) {
            continue
        }
        return -1 // anything else — bail rather than risk running away past the type.
    }
    return -1
}

// Scan ONE type atom (name/qualified/generic/array, a bracketed/object/tuple type, or a scalar/literal)
// starting at `start`. Returns the index just past the atom, or -1 when the token at `start` is not a
// recognizable type atom (caller stops — never marking beyond what it is sure of).
function scanTypeAtom(
    tokens: Tok[],
    start: number,
    matchClose: Map<number, number>,
    skip: Set<number>,
): number {
    let i = start
    // Leading type operators (`keyof`/`readonly`/`infer`/`typeof`/`unique`/`new`). Some (`readonly`,
    // `unique`) tokenize as identifier-like contextual keywords, so mark them too or they'd be rewritten.
    while (i < tokens.length && LEADING_TYPE_OPS.has(tokenAt(tokens, i).kind)) {
        if (isIdentifierLike(tokenAt(tokens, i).kind)) skip.add(i)
        i++
    }
    const k = tokens[i]?.kind
    if (k === undefined) return -1

    if (isIdentifierLike(k)) {
        skip.add(i)
        i++
        // Qualified name `A.B.C`.
        while (
            tokens[i]?.kind === K.DotToken &&
            tokens[i + 1] &&
            isIdentifierLike(tokenAt(tokens, i + 1).kind)
        ) {
            skip.add(i + 1)
            i += 2
        }
        // Generic arguments `Foo<…>`. Scanned into a scratch set and merged only on success: a bailing
        // `scanAngle` has already marked every identifier it walked past, and keeping those would
        // OVER-mark (silently masking a real value reference) — the one direction the safety invariant
        // above forbids.
        if (tokens[i]?.kind === K.LessThanToken) {
            const angleSkip = new Set<number>()
            const after = scanAngle(tokens, i, matchClose, angleSkip)
            if (after < 0) return i // couldn't match — stop cleanly before the `<`.
            for (const idx of angleSkip) skip.add(idx)
            i = after
        }
        // Postfix array / indexed access `Foo[]`, `Foo['x']`, `Foo[K]`.
        while (tokens[i]?.kind === K.OpenBracketToken) {
            const close = matchClose.get(i)
            if (close === undefined) break
            markInner(tokens, i, close, skip)
            i = close + 1
        }
        return i
    }

    // Parenthesized / function / object / tuple type — mark inner type names, then continue.
    if (k === K.OpenParenToken || k === K.OpenBraceToken || k === K.OpenBracketToken) {
        const close = matchClose.get(i)
        if (close === undefined) return -1
        markInner(tokens, i, close, skip)
        i = close + 1
        // Function type `(…) => ReturnType` — recurse for the return type.
        if (tokens[i]?.kind === K.EqualsGreaterThanToken) {
            const after = scanTypeAtom(tokens, i + 1, matchClose, skip)
            if (after > 0) i = after
        }
        return i
    }

    if (SCALAR_TYPE_ATOMS.has(k)) {
        i++
        while (tokens[i]?.kind === K.OpenBracketToken) {
            const close = matchClose.get(i)
            if (close === undefined) break
            markInner(tokens, i, close, skip)
            i = close + 1
        }
        return i
    }

    return -1
}

// Mark the full type operand (a chain of atoms joined by `|`/`&`) that begins at `start`. Returns the
// index just past the operand, or -1 when `start` is not a recognizable type — callers that need to
// know what FOLLOWS a type (`) : T =>`) test the return; the rest ignore it.
function scanTypeOperand(
    tokens: Tok[],
    start: number,
    matchClose: Map<number, number>,
    skip: Set<number>,
): number {
    let i = start
    for (;;) {
        const after = scanTypeAtom(tokens, i, matchClose, skip)
        if (after < 0) return i === start ? -1 : i
        const next = tokens[after]?.kind
        if (next === K.BarToken || next === K.AmpersandToken) {
            i = after + 1 // union / intersection stays in type position
            continue
        }
        return after
    }
}

// Does token `i` begin a statement? Used to tell a `type X = …` DECLARATION from a value binding that
// happens to be named `type` (`type = 5`, `f(type)`), which the scanner hands us as the same kind.
function atStatementStart(tokens: Tok[], i: number): boolean {
    if (i === 0) return true
    if (tokenAt(tokens, i).nl) return true
    const prev = tokenAt(tokens, i - 1).kind
    return (
        prev === K.SemicolonToken ||
        prev === K.OpenBraceToken ||
        prev === K.CloseBraceToken ||
        prev === K.ExportKeyword ||
        prev === K.DeclareKeyword
    )
}

// Mark the annotation colons of ONE parameter list `(`…`)` plus its return type. Only called on a span
// already proven to be a parameter list (it follows `function`, or its `)` is followed by `=>`), so a
// colon at the list's own bracket depth is an annotation. The depth test is what keeps a DESTRUCTURING
// RENAME out (`function f({ rest: local })` — that colon sits one bracket deeper), while still reaching
// the annotation on a destructured param (`function f({ a }: { rest: string })`).
function markParamTypes(
    tokens: Tok[],
    open: number,
    close: number,
    braces: BraceInfo,
    skip: Set<number>,
): void {
    const { matchClose, bracketDepth } = braces
    const innerDepth = numberAt(bracketDepth, open) + 1
    for (let i = open + 1; i < close; i++) {
        if (tokenAt(tokens, i).kind === K.ColonToken && numberAt(bracketDepth, i) === innerDepth) {
            scanTypeOperand(tokens, i + 1, matchClose, skip)
        }
    }
    if (tokens[close + 1]?.kind === K.ColonToken)
        scanTypeOperand(tokens, close + 2, matchClose, skip) // return type
}

// Mark the annotations on the DIRECT members of a class body or an object literal — the method form
// `m(a: T): R {…}`, which neither the `function` nor the arrow entry point can see.
//
// `isClassBody` gates PROPERTY annotations (`x: T`). They exist only in a class: inside an object
// literal `x: v` is a VALUE, and marking that would silently stop a cell read from being rewritten —
// which is the one failure no value assertion catches. It is also why this walks members rather than
// scanning for `name (` anywhere: a call statement followed by a block (`f(a ? b : c)\n{ … }`) has the
// same token shape, and inside a plain block there is no member position to match.
function markMemberTypes(
    tokens: Tok[],
    open: number,
    close: number,
    braces: BraceInfo,
    skip: Set<number>,
    isClassBody: boolean,
): void {
    const { matchClose, bracketDepth } = braces
    const innerDepth = numberAt(bracketDepth, open) + 1
    for (let i = open + 1; i < close; i++) {
        if (numberAt(bracketDepth, i) !== innerDepth) continue
        // A member NAME — including a `#private` one, which is not identifier-like and would otherwise
        // hide the annotation that follows it (`#p: rest`).
        const nameKind = tokenAt(tokens, i).kind
        if (!isIdentifierLike(nameKind) && nameKind !== K.PrivateIdentifier) continue
        const nextKind = tokens[i + 1]?.kind
        if (nextKind === K.OpenParenToken) {
            const paramClose = matchClose.get(i + 1)
            if (paramClose !== undefined) markParamTypes(tokens, i + 1, paramClose, braces, skip)
            continue
        }
        if (!isClassBody) continue
        // `x: T` / `x?: T` — a class PROPERTY annotation.
        const colon =
            nextKind === K.ColonToken
                ? i + 1
                : nextKind === K.QuestionToken && tokens[i + 2]?.kind === K.ColonToken
                  ? i + 2
                  : -1
        if (colon !== -1) scanTypeOperand(tokens, colon + 1, matchClose, skip)
    }
}

// The body `{` of the `class` whose keyword is at `classIdx`, or -1. The first `{` at the keyword's own
// bracket depth — which a generic heritage clause (`extends Base<{ a: 1 }>`) can spoof, since angle
// brackets carry no depth. Picking the wrong brace finds no members and marks nothing, so the spoof
// costs coverage rather than correctness.
function classBodyOpen(tokens: Tok[], classIdx: number, braces: BraceInfo): number {
    const baseDepth = numberAt(braces.bracketDepth, classIdx)
    for (let i = classIdx + 1; i < tokens.length; i++) {
        const kind = tokenAt(tokens, i).kind
        if (kind === K.OpenBraceToken && numberAt(braces.bracketDepth, i) === baseDepth) return i
        if (kind === K.SemicolonToken && numberAt(braces.bracketDepth, i) === baseDepth) return -1
    }
    return -1
}

// The token indices that belong to a TYPE — skipped by `rewriteCellRefs` and the free-identifier passes
// so a type name is never rewritten to a cell READ (`rest` → `rest()`) or to `$scope.<name>`.
//
// A cell name in a type position is not exotic: props and cells share a component's vocabulary, so
// `const rest = memo(…)` beside `props<{ rest?: string }>()` is ordinary authoring — and it used to emit
// `props<{ rest()?: string }>()`, a build failure. (Type-literal members whose annotation is NOT optional
// escaped by accident, via `isObjectKey`'s `name:` test — so the same script broke or not depending on a
// `?`.)
//
// Each branch below is an ENTRY POINT into the shared `scanTypeOperand`/`scanAngle` walkers; the walkers
// own the grammar and stop at the first token they cannot classify, so a new entry point can only widen
// coverage, never run away. Deliberately NOT covered (under-marking is the safe direction): generic
// arrow type params (`<T,>(x: T) => x`), whose `<` has no preceding name to prove it opens a type.
export function markTypeSkips(tokens: Tok[], braces: BraceInfo): Set<number> {
    const { matchClose, matchOpen } = braces
    const skip = new Set<number>()
    const n = tokens.length

    for (let i = 0; i < n; i++) {
        const k = tokenAt(tokens, i).kind

        // `x as T` / `x satisfies T`
        if (k === K.AsKeyword || k === K.SatisfiesKeyword) {
            scanTypeOperand(tokens, i + 1, matchClose, skip)
            continue
        }

        // `let|const|var <pattern>: T` — the pattern is a name or a balanced `{…}`/`[…]`. Only the first
        // declarator is walked; a second annotated declarator on one statement is rare, and missing it
        // just leaves today's behaviour.
        if (k === K.LetKeyword || k === K.ConstKeyword || k === K.VarKeyword) {
            let j = i + 1
            const pk = tokens[j]?.kind
            if (pk === K.OpenBraceToken || pk === K.OpenBracketToken) {
                const close = matchClose.get(j)
                if (close === undefined) continue
                j = close + 1
            } else if (pk !== undefined && isIdentifierLike(pk)) {
                j++
            } else continue
            if (tokens[j]?.kind === K.ColonToken) scanTypeOperand(tokens, j + 1, matchClose, skip)
            continue
        }

        // `type X<…> = T` — everything right of the `=` is type, so mark the whole RHS extent rather
        // than walking it as an operand (a conditional/mapped type would stop the walker early).
        if (k === K.TypeKeyword && atStatementStart(tokens, i)) {
            const nameIdx = i + 1
            const nameKind = tokens[nameIdx]?.kind
            if (nameKind === undefined || !isIdentifierLike(nameKind)) continue
            let j = nameIdx + 1
            if (tokens[j]?.kind === K.LessThanToken) {
                const angleSkip = new Set<number>()
                const after = scanAngle(tokens, j, matchClose, angleSkip)
                if (after < 0) continue
                for (const idx of angleSkip) skip.add(idx)
                j = after
            }
            if (tokens[j]?.kind !== K.EqualsToken) continue
            skip.add(i)
            skip.add(nameIdx)
            const end = rhsExtent(tokens, j + 1)
            for (let m = j + 1; m <= end; m++)
                if (isIdentifierLike(tokenAt(tokens, m).kind)) skip.add(m)
            continue
        }

        // `interface X<…> extends Y { … }` — head and body are entirely type.
        if (k === K.InterfaceKeyword) {
            let open = -1
            for (let m = i + 1; m < n; m++) {
                const mk = tokenAt(tokens, m).kind
                if (mk === K.OpenBraceToken) {
                    open = m
                    break
                }
                if (mk === K.SemicolonToken) break
            }
            if (open === -1) continue
            const close = matchClose.get(open)
            if (close === undefined) continue
            for (let m = i + 1; m < open; m++)
                if (isIdentifierLike(tokenAt(tokens, m).kind)) skip.add(m)
            markInner(tokens, open, close, skip)
            continue
        }

        // Type ARGUMENTS of a call / `new` / tagged template: `props<{…}>()`, `new Map<K, V>()`,
        // `fn<T>\`…\``. The trailing `(`/template is what distinguishes them from a `<` comparison —
        // and it is the same disambiguation TypeScript itself applies in a `.ts` file, so `a<b,c>(d)`
        // is a generic call here for the same reason it is one there.
        if (k === K.LessThanToken && i > 0 && isIdentifierLike(tokenAt(tokens, i - 1).kind)) {
            const angleSkip = new Set<number>()
            const after = scanAngle(tokens, i, matchClose, angleSkip)
            if (after < 0) continue
            const nextKind = tokens[after]?.kind
            if (
                nextKind === K.OpenParenToken ||
                nextKind === K.NoSubstitutionTemplateLiteral ||
                nextKind === K.TemplateHead
            ) {
                for (const idx of angleSkip) skip.add(idx)
            }
            continue
        }

        // Class member annotations — method params/returns and property types.
        if (k === K.ClassKeyword) {
            const open = classBodyOpen(tokens, i, braces)
            if (open === -1) continue
            const close = matchClose.get(open)
            if (close !== undefined) markMemberTypes(tokens, open, close, braces, skip, true)
            continue
        }

        // Object-literal SHORTHAND methods (`{ m(a: T) {…} }`). The `{ m: (a: T) => … }` spelling is
        // already covered by the arrow entry point below.
        if (k === K.OpenBraceToken && braces.isObjectBrace.has(i)) {
            const close = matchClose.get(i)
            if (close !== undefined) markMemberTypes(tokens, i, close, braces, skip, false)
            continue
        }

        // Parameter annotations + return type of a `function` declaration/expression.
        if (k === K.FunctionKeyword) {
            let p = i + 1
            while (p < n && tokenAt(tokens, p).kind !== K.OpenParenToken) {
                if (tokenAt(tokens, p).kind === K.OpenBraceToken) break // body reached — no param list
                p++
            }
            if (p >= n || tokenAt(tokens, p).kind !== K.OpenParenToken) continue
            const close = matchClose.get(p)
            if (close !== undefined) markParamTypes(tokens, p, close, braces, skip)
            continue
        }

        // Parameter annotations of an arrow. A `)` immediately before `=>` is a parameter list by the JS
        // grammar — there is no other production for it.
        if (k === K.EqualsGreaterThanToken && i > 0) {
            if (tokenAt(tokens, i - 1).kind !== K.CloseParenToken) continue
            const open = matchOpen.get(i - 1)
            if (open !== undefined) markParamTypes(tokens, open, i - 1, braces, skip)
            continue
        }

        // An arrow carrying a RETURN annotation puts the type between `)` and `=>`, so the branch above
        // cannot see it. `) : <type> =>` is unambiguous — no other production ends a parenthesized span
        // with an annotation followed by an arrow — so proving the `=>` follows the type proves the
        // parens are a parameter list.
        if (k === K.CloseParenToken && tokens[i + 1]?.kind === K.ColonToken) {
            const returnSkip = new Set<number>()
            const after = scanTypeOperand(tokens, i + 2, matchClose, returnSkip)
            if (after < 0 || tokens[after]?.kind !== K.EqualsGreaterThanToken) continue
            const open = matchOpen.get(i)
            if (open === undefined) continue
            for (const idx of returnSkip) skip.add(idx)
            markParamTypes(tokens, open, i, braces, skip)
        }
    }

    return skip
}
