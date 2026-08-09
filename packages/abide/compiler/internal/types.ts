// Which tokens are a TYPE, so the desugar leaves them exactly as the author wrote them.
//
// A `.abide` `<script>` is TypeScript, and a type carries no expressions: a cell named inside one is
// neither a read nor a binding, and every rewrite must pass over it. Without that, `type A = typeof n`
// became `typeof n()` — which is not valid TypeScript in any dialect — and, worse, `const a: typeof n`
// registered `n` as a BINDING, shadowing the cell for the rest of the block so every later read
// silently stopped desugaring and `tsc` had nothing to report.
//
// The grammar is the one `shape.ts` already has. Two parsers that could disagree about where a type
// stops would put the rewrite one token off at exactly the place they disagreed, so there is one, and
// it is the same one that reads a handler's arguments into a schema.
//
// The `<` ambiguity is resolved the way TypeScript resolves it — speculative parse, accepted only
// when the list closes and what follows may follow type arguments. `a < b, c > (d)` is read as a
// generic call by that rule, and by tsc; matching the real disambiguation is the only available
// definition of exact, because the language does not have another one.

import { SyntaxKind } from 'typescript/unstable/ast'
import type { Token } from './lex.ts'
import { closes, TypeReader } from './shape.ts'

/** Words that begin a declaration whose whole tail is types. */
const TYPE_STATEMENTS = new Set(['interface', 'declare'])

/** After one of these, what follows is a type — a cast, or a class heritage clause. */
const TYPE_OPERATORS = new Set(['as', 'satisfies', 'implements'])

/**
 * One byte per token: 1 where the token is part of a type.
 *
 * `nesting` is the depth AFTER each token, which is what the caller already computed for its own
 * scoping — the ternary rule below needs it, because a `?` and its `:` are only a pair at one level.
 */
export function typeRegions(
    tokens: Token[],
    nesting: number[],
    expression: boolean,
): Uint8Array {
    const marks = new Uint8Array(tokens.length)
    if (tokens.length === 0) return marks
    const types = new TypeReader(tokens)

    const mark = (from: number, to: number): void => {
        for (let i = from; i < to && i < tokens.length; i++) marks[i] = 1
    }

    // A `?` at some level claims the next `:` at that level, so a ternary's colon is not an
    // annotation. Counted per level rather than as one stack, because `a ? f({ x: 1 }) : b` dips
    // in and out between the two halves.
    const pending = new Map<number, number>()

    for (let i = 0; i < tokens.length; i++) {
        if (marks[i] === 1) continue
        const token = tokens[i] as Token
        const level = nesting[i] as number
        const text = token.text

        // `type X = …` and `type X<T> = …`. The name is not a type; everything from `=` is.
        if (
            text === 'type' &&
            startsStatement(tokens, i) &&
            tokens[i + 1]?.kind === SyntaxKind.Identifier
        ) {
            let at = i + 2
            if (tokens[at]?.kind === SyntaxKind.LessThanToken) at = closeAngle(tokens, at)
            if (tokens[at]?.kind === SyntaxKind.EqualsToken) {
                mark(i + 2, types.extent(at + 1))
            }
            continue
        }

        // `interface X … { … }` and `declare …` — the whole declaration is types.
        if (TYPE_STATEMENTS.has(text) && startsStatement(tokens, i)) {
            mark(i + 1, statementEnd(tokens, nesting, i, level))
            continue
        }

        // `x as T`, `x satisfies T`, `class C implements I`.
        if (TYPE_OPERATORS.has(text) && tokens[i - 1] !== undefined) {
            mark(i + 1, types.extent(i + 1))
            continue
        }

        // A type PARAMETER list: `function f<T extends U>(…)`, `class C<T>`. Recognised by sitting
        // directly after a declaration's name, which is what separates it from a comparison.
        if (token.kind === SyntaxKind.LessThanToken && declaresParameters(tokens, i)) {
            mark(i, closeAngle(tokens, i))
            continue
        }

        // A type ARGUMENT list: `new Map<string, T>()`, `f<T>(x)`. TypeScript's own rule.
        if (token.kind === SyntaxKind.LessThanToken && follows(tokens, i)) {
            const after = types.tryTypeArguments(i)
            if (after > i) {
                mark(i, after)
                continue
            }
        }

        if (token.kind === SyntaxKind.QuestionToken) {
            // `x?: T` is an optional MEMBER, not a ternary — the `:` beside it is the annotation.
            if (tokens[i + 1]?.kind === SyntaxKind.ColonToken) continue
            pending.set(level, (pending.get(level) ?? 0) + 1)
            continue
        }

        if (token.kind === SyntaxKind.ColonToken) {
            const owed = pending.get(level) ?? 0
            if (owed > 0) {
                // The other half of a ternary.
                pending.set(level, owed - 1)
                continue
            }
            if (!annotates(tokens, nesting, i, expression)) continue
            mark(i + 1, types.extent(i + 1))
        }
    }
    return marks
}

/**
 * Is `:` at `i` an annotation rather than an object-literal key or a label?
 *
 * The object-literal question is the only hard half, and it is the same one the desugar answers for
 * its own scoping: a `{` that follows `(`, `,`, `=`, `:`, `[` or `return` opened a literal, and one
 * that follows anything else opened a block.
 */
function annotates(tokens: Token[], nesting: number[], i: number, expression: boolean): boolean {
    const previous = tokens[i - 1]
    if (previous === undefined) return false
    // `case 'x':` and `default:` are neither.
    if (previous.text === 'default') return false
    for (let back = i - 2; back >= 0 && back > i - 8; back--) {
        if ((tokens[back] as Token).text === 'case' && (nesting[back] as number) === (nesting[i] as number)) {
            return false
        }
        if ((tokens[back] as Token).kind === SyntaxKind.SemicolonToken) break
    }
    const kind = previous.kind
    const named =
        kind === SyntaxKind.Identifier ||
        kind === SyntaxKind.CloseParenToken ||
        kind === SyntaxKind.CloseBracketToken ||
        kind === SyntaxKind.CloseBraceToken ||
        kind === SyntaxKind.QuestionToken ||
        previous.text === 'this'
    if (!named) return false
    return !inObjectLiteral(tokens, nesting, i, expression)
}

/**
 * Is the brace enclosing token `i` an object literal rather than a block?
 *
 * A `{` that follows `=>`, `)`, `;` or nothing opens a BLOCK; after `(`, `,`, `=`, `:` or `return`
 * it opens an object literal. With nothing before it, the region's own kind decides: a template
 * expression is an expression, a `<script>` body is statements.
 *
 * The desugar asks this to scope a binding and this file asks it to tell an annotation from a member
 * value, and the two have to agree — a `:` read as a type here while the desugar reads the enclosing
 * `{` as a literal is a cell that silently stops desugaring, with valid output and no diagnostic.
 */
export function inObjectLiteral(tokens: Token[], nesting: number[], i: number, expression: boolean): boolean {
    const level = nesting[i] as number
    for (let back = i - 1; back >= 0; back--) {
        if ((nesting[back] as number) !== level) continue
        const token = tokens[back] as Token
        if (token.kind !== SyntaxKind.OpenBraceToken) continue
        const before = tokens[back - 1]
        if (before === undefined) return expression
        return (
            before.kind === SyntaxKind.OpenParenToken ||
            before.kind === SyntaxKind.CommaToken ||
            before.kind === SyntaxKind.EqualsToken ||
            before.kind === SyntaxKind.ColonToken ||
            before.kind === SyntaxKind.OpenBracketToken ||
            before.kind === SyntaxKind.ReturnKeyword
        )
    }
    return false
}

/**
 * Does a token begin a statement?
 *
 * A `;`, a brace, `export`/`declare` in front of it — or a NEWLINE between it and whatever came
 * before, which is the common case in a codebase that does not write semicolons. That last one is
 * the scanner's OWN answer, off `startsLine`, rather than a second backward scan for `\n` over a
 * source whose start may be the whole template above this region.
 */
function startsStatement(tokens: Token[], i: number): boolean {
    const previous = tokens[i - 1]
    if (previous === undefined) return true
    if (
        previous.kind === SyntaxKind.SemicolonToken ||
        previous.kind === SyntaxKind.OpenBraceToken ||
        previous.kind === SyntaxKind.CloseBraceToken ||
        previous.kind === SyntaxKind.ExportKeyword ||
        previous.text === 'declare'
    ) {
        return true
    }
    return (tokens[i] as Token).startsLine
}

/** `<` directly after the NAME of a function, class or interface — a parameter list, not a compare. */
function declaresParameters(tokens: Token[], i: number): boolean {
    const name = tokens[i - 1]
    const declarer = tokens[i - 2]
    if (name?.kind !== SyntaxKind.Identifier || declarer === undefined) return false
    return (
        declarer.kind === SyntaxKind.FunctionKeyword ||
        declarer.kind === SyntaxKind.ClassKeyword ||
        declarer.text === 'interface' ||
        declarer.text === 'type'
    )
}

/** Could a type-argument list start here? Only after something a call or an index can follow. */
function follows(tokens: Token[], i: number): boolean {
    const previous = tokens[i - 1]
    if (previous === undefined) return false
    return (
        previous.kind === SyntaxKind.Identifier ||
        previous.kind === SyntaxKind.CloseParenToken ||
        previous.kind === SyntaxKind.CloseBracketToken
    )
}

/**
 * Past the `>` that closes the `<` at `at`. `>>` closes two, so the run is counted rather than tested.
 *
 * `at + 1` when nothing closes it, which is also how a caller tells the two apart: a real list is at
 * least `<T>`, so it can never land there.
 */
export function closeAngle(tokens: Token[], at: number): number {
    let depth = 0
    for (let i = at; i < tokens.length; i++) {
        const token = tokens[i] as Token
        if (token.kind === SyntaxKind.LessThanToken) depth++
        else {
            // `closes` rather than a second run-counter: the `>>>`-implied cap and the all-`>` rule
            // are the same rule the type reader applies, and it is what decides where a list ends.
            const closing = closes(token)
            if (closing > 0) {
                depth -= closing
                if (depth <= 0) return i + 1
            }
        }
    }
    return at + 1
}

/** The end of the declaration beginning at `i` — its closing brace, or its `;`, or the next line. */
function statementEnd(tokens: Token[], nesting: number[], i: number, level: number): number {
    for (let at = i + 1; at < tokens.length; at++) {
        const token = tokens[at] as Token
        const depth = nesting[at] as number
        if (token.kind === SyntaxKind.OpenBraceToken) {
            // An interface body: everything to the matching close.
            let braces = 0
            for (let j = at; j < tokens.length; j++) {
                const kind = (tokens[j] as Token).kind
                if (kind === SyntaxKind.OpenBraceToken) braces++
                else if (kind === SyntaxKind.CloseBraceToken && --braces === 0) return j + 1
            }
            return tokens.length
        }
        if (depth <= level && token.kind === SyntaxKind.SemicolonToken) return at + 1
        if (depth < level) return at
    }
    return tokens.length
}
