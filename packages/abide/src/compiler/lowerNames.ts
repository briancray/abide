import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'
import { REACTIVE_MEMBERS } from './REACTIVE_MEMBERS.ts'

// 31.1 and 31.4 — inside a `.abide` a name bound to a `Reactive` is READ where it stands and
// WRITTEN where it is assigned. The rewrite is at the TOKEN level, driven by TypeScript's own
// scanner, because the alternative is a regex that cannot tell `n` in `n + 1` from `n` in
// `'n'` or in `obj.n`. The expression grammar is still never parsed: a scanner says where the
// tokens are, not what they mean.
//
// 31.7 is a property of the rewrite rather than a case in it: `n()` is an identifier followed by
// `(`, which is left exactly as written, and `n.set(v)` is an identifier followed by `.`.

const {
    Identifier: IDENTIFIER,
    EqualsToken: EQUALS,
    DotToken: DOT,
    OpenParenToken: OPEN_PAREN,
    CloseParenToken: CLOSE_PAREN,
    OpenBracketToken: OPEN_BRACKET,
    CloseBracketToken: CLOSE_BRACKET,
    OpenBraceToken: OPEN_BRACE,
    CloseBraceToken: CLOSE_BRACE,
    CommaToken: COMMA,
    SemicolonToken: SEMICOLON,
    EndOfFile: END_OF_FILE,
} = SyntaxKind

// `let n = reactive(0)` binds the name; it does not write through it. Without this the
// declaration lowers to `n.set(reactive(0))` and the binding is gone.
const DECLARATION = new Set<SyntaxKind>([
    SyntaxKind.ConstKeyword,
    SyntaxKind.LetKeyword,
    SyntaxKind.VarKeyword,
])

// An import CLAUSE names bindings, it does not read them: `import { n } from '...'` lowered to
// `import { n() }` is not valid in any grammar. The whole statement is skipped, from the keyword
// to its specifier — which is also why `splitImports` and this agree on where one ends.

// `+=`, `-=`, `*=`, `/=`, `%=`, `**=` — an op-assign on a reactive name reads and writes, so it
// lowers to `n.set(n() <op> (rhs))`. A table because the alternative is six branches.
const OP_ASSIGN = new Map<SyntaxKind, string>([
    [SyntaxKind.PlusEqualsToken, '+'],
    [SyntaxKind.MinusEqualsToken, '-'],
    [SyntaxKind.AsteriskEqualsToken, '*'],
    [SyntaxKind.SlashEqualsToken, '/'],
    [SyntaxKind.PercentEqualsToken, '%'],
    [SyntaxKind.AsteriskAsteriskEqualsToken, '**'],
])

export function lowerNames(
    source: string,
    reactive: ReadonlySet<string>,
): string {
    if (reactive.size === 0) return source
    const tokens = tokenise(source)
    let out = ''
    let at = 0

    // Spans the rewrite must not touch: each import statement, from its keyword to its specifier.
    const skipped: { start: number; end: number }[] = []
    for (let i = 0; i < tokens.length; i += 1) {
        if ((tokens[i] as Token).kind !== SyntaxKind.ImportKeyword) continue
        const start = (tokens[i] as Token).start
        for (let j = i + 1; j < tokens.length; j += 1) {
            const token = tokens[j] as Token
            // A dynamic `import(...)` is an expression and its argument IS read.
            if (token.kind === OPEN_PAREN) break
            if (token.kind !== SyntaxKind.StringLiteral) continue
            skipped.push({ start, end: token.end })
            i = j
            break
        }
    }
    const isSkipped = (at: number): boolean => {
        for (const span of skipped)
            if (at >= span.start && at < span.end) return true
        return false
    }

    // A DESTRUCTURING PATTERN BINDS NAMES, it does not read them — `const { n } = x` declares `n`
    // and `const { n: m } = x` declares `m`. Skipped as a whole, the same way an import clause is,
    // because the immediately-preceding-token test that catches `let n` cannot see past a brace.
    for (let i = 0; i < tokens.length - 1; i += 1) {
        if (!DECLARATION.has((tokens[i] as Token).kind)) continue
        const opener = tokens[i + 1] as Token
        if (opener.kind !== OPEN_BRACE && opener.kind !== OPEN_BRACKET) continue
        let depth = 0
        for (let j = i + 1; j < tokens.length; j += 1) {
            const token = tokens[j] as Token
            if (token.kind === OPEN_BRACE || token.kind === OPEN_BRACKET)
                depth += 1
            else if (
                token.kind === CLOSE_BRACE ||
                token.kind === CLOSE_BRACKET
            ) {
                depth -= 1
                if (depth === 0) {
                    skipped.push({ start: opener.start, end: token.end })
                    i = j
                    break
                }
            }
        }
    }

    // A PARAMETER IS A BINDING, NOT A READ — the third position where that is true, after an
    // import clause and a destructuring pattern. `function f(region)` lowered to
    // `function f(region())` and `(rows) => …` to `(rows()) => …`; neither is a program. The
    // parameter list is skipped whole, which also covers a default value that reads the name it
    // shadows — a case worth being wrong about loudly rather than quietly.
    const closeOf = (open: number): number => {
        let depth = 0
        for (let j = open; j < tokens.length; j += 1) {
            const kind = (tokens[j] as Token).kind
            if (kind === OPEN_PAREN) depth += 1
            else if (kind === CLOSE_PAREN) {
                depth -= 1
                if (depth === 0) return j
            }
        }
        return -1
    }
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i] as Token
        // `rows => …`, the parenthesis-free arrow.
        if (
            token.kind === IDENTIFIER &&
            (tokens[i + 1] as Token | undefined)?.kind ===
                SyntaxKind.EqualsGreaterThanToken
        ) {
            skipped.push({ start: token.start, end: token.end })
            continue
        }
        if (token.kind !== OPEN_PAREN) continue
        const previousKind = i > 0 ? (tokens[i - 1] as Token).kind : undefined
        const close = closeOf(i)
        if (close === -1) continue
        const afterKind = (tokens[close + 1] as Token | undefined)?.kind
        // A parameter list is either what follows `function` (with or without a name), or a
        // parenthesised list an `=>` follows.
        const isFunction =
            previousKind === SyntaxKind.FunctionKeyword ||
            (previousKind === IDENTIFIER &&
                i > 1 &&
                (tokens[i - 2] as Token).kind === SyntaxKind.FunctionKeyword)
        if (isFunction || afterKind === SyntaxKind.EqualsGreaterThanToken)
            skipped.push({
                start: (tokens[i] as Token).start,
                end: (tokens[close] as Token).end,
            })
    }

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i] as Token
        if (token.kind !== IDENTIFIER || !reactive.has(token.text)) continue
        if (isSkipped(token.start)) continue
        // A member name is not the binding: `obj.n` is a property, `n.set` is the API (31.7).
        const previous = i > 0 ? (tokens[i - 1] as Token) : undefined
        if (previous?.kind === DOT) continue
        if (previous !== undefined && DECLARATION.has(previous.kind)) continue

        // A name at the very end of an expression is the commonest read of all — `{n}` — so an
        // absent next token is a read, not a reason to skip.
        const next = tokens[i + 1] as Token | undefined

        // 31.7 — the explicit spelling keeps compiling. `n()` is already right.
        if (next?.kind === OPEN_PAREN) continue

        // 31.5, 31.6 — A MEMBER REACHES THE VALUE unless the `Reactive` declares it. `n.set(v)`
        // is the API and passes through; `regions.join(', ')` is the array's own method and has
        // to read the value first, or it is a call on a function that is not there.
        if (next?.kind === DOT) {
            const member = tokens[i + 2] as Token | undefined
            if (member === undefined || REACTIVE_MEMBERS.has(member.text))
                continue
            out += `${source.slice(at, token.start)}${token.text}()`
            at = token.end
            continue
        }

        const op = next === undefined ? undefined : OP_ASSIGN.get(next.kind)
        if (next !== undefined && (next.kind === EQUALS || op !== undefined)) {
            const rhs = rightHandSide(tokens, i + 2, source)
            const value = lowerNames(
                source.slice(next.end, rhs.end).trim(),
                reactive,
            )
            out += source.slice(at, token.start)
            out +=
                op === undefined
                    ? `${token.text}.set(${value})`
                    : `${token.text}.set(${token.text}() ${op} (${value}))`
            at = rhs.end
            i = rhs.index - 1
            continue
        }

        // AN OBJECT LITERAL'S KEY IS NOT A READ. `{ limit: n }` names a property; lowering the
        // key gives `{ limit(): n }`, a method with a body that is not one. The preceding token
        // is what tells a key from a ternary's `:` or a label.
        if (
            (previous?.kind === OPEN_BRACE || previous?.kind === COMMA) &&
            next?.kind === SyntaxKind.ColonToken
        )
            continue

        // AN OBJECT SHORTHAND IS A KEY AND A VALUE. `{ n }` means `{ n: n }`, so the key has to
        // stay `n` and only the value lowers — `{ n() }` is a method with no body and the module
        // does not parse. Found by compiling the corpus, in seven files.
        if (
            (previous?.kind === OPEN_BRACE || previous?.kind === COMMA) &&
            (next?.kind === COMMA || next?.kind === CLOSE_BRACE)
        ) {
            out += `${source.slice(at, token.start)}${token.text}: ${token.text}()`
            at = token.end
            continue
        }

        // 31.1 — every other position is a read.
        out += `${source.slice(at, token.start)}${token.text}()`
        at = token.end
    }

    return out + source.slice(at)
}

type Token = { kind: SyntaxKind; text: string; start: number; end: number }

function tokenise(source: string): Token[] {
    const scanner = createScanner(true, undefined, source)
    const tokens: Token[] = []
    // A TEMPLATE LITERAL IS NOT ORDINARY TOKENS. `` `a${b}c` `` scans as TemplateHead, then `b`,
    // then a CLOSE BRACE that has to be RE-SCANNED as the literal's continuation — without that
    // the scanner reads `c\`` as ordinary code, and a bare word in the TEXT of a template gets
    // rewritten as if it were a read. Found by compiling the corpus: `${owner} — … of notes`
    // lowered to `${owner())} — … of notes()`, which is not a program.
    const templates: number[] = []
    while (true) {
        let kind = scanner.scan()
        if (kind === SyntaxKind.TemplateHead) templates.push(0)
        else if (
            kind === CLOSE_BRACE &&
            templates.length > 0 &&
            templates[templates.length - 1] === 0
        ) {
            kind = scanner.reScanTemplateToken(false)
            if (kind === SyntaxKind.TemplateTail) templates.pop()
        } else if (kind === OPEN_BRACE && templates.length > 0)
            templates[templates.length - 1] =
                (templates[templates.length - 1] as number) + 1
        else if (kind === CLOSE_BRACE && templates.length > 0)
            templates[templates.length - 1] =
                (templates[templates.length - 1] as number) - 1
        if (kind === END_OF_FILE) break
        tokens.push({
            kind,
            text: scanner.getTokenText(),
            start: scanner.getTokenStart(),
            end: scanner.getTokenEnd(),
        })
    }
    return tokens
}

// Tokens that can END a value. A line break after one of these ends the statement unless what
// follows plainly continues it — which is what JavaScript's automatic semicolon insertion does,
// and what a scan that only looks for `;` misses.
const ENDS_VALUE = new Set<SyntaxKind>([
    SyntaxKind.Identifier,
    SyntaxKind.StringLiteral,
    SyntaxKind.NumericLiteral,
    SyntaxKind.BigIntLiteral,
    SyntaxKind.NoSubstitutionTemplateLiteral,
    SyntaxKind.TemplateTail,
    SyntaxKind.CloseParenToken,
    SyntaxKind.CloseBracketToken,
    SyntaxKind.CloseBraceToken,
    SyntaxKind.TrueKeyword,
    SyntaxKind.FalseKeyword,
    SyntaxKind.NullKeyword,
    SyntaxKind.ThisKeyword,
])

// Tokens that plainly CONTINUE a value across a line break: `a\n.b`, `a\n + 1`, `f(a\n, b)`.
const CONTINUES_VALUE = new Set<SyntaxKind>([
    SyntaxKind.DotToken,
    SyntaxKind.QuestionDotToken,
    SyntaxKind.CommaToken,
    SyntaxKind.CloseParenToken,
    SyntaxKind.CloseBracketToken,
    SyntaxKind.CloseBraceToken,
    SyntaxKind.QuestionToken,
    SyntaxKind.ColonToken,
])

// Where the value being assigned ends: the first `,` or `;` at depth zero, the bracket that closes
// the region this assignment is inside, or A LINE BREAK that ends the statement.
//
// THE LINE BREAK IS NOT OPTIONAL. `refusal = ''` followed by `return` on the next line has no
// semicolon between them, and a scan looking only for one produced `refusal.set('' return)` —
// found by compiling the corpus, in a file whose author simply does not write semicolons.
function rightHandSide(
    tokens: Token[],
    from: number,
    source: string,
): { index: number; end: number } {
    let depth = 0
    for (let i = from; i < tokens.length; i += 1) {
        const token = tokens[i] as Token
        const previous = i > from ? (tokens[i - 1] as Token) : undefined
        if (
            depth === 0 &&
            previous !== undefined &&
            ENDS_VALUE.has(previous.kind) &&
            !CONTINUES_VALUE.has(token.kind) &&
            source.slice(previous.end, token.start).includes('\n')
        )
            return { index: i, end: previous.end }
        if (
            token.kind === OPEN_PAREN ||
            token.kind === OPEN_BRACKET ||
            token.kind === OPEN_BRACE
        ) {
            depth += 1
            continue
        }
        if (
            token.kind === CLOSE_PAREN ||
            token.kind === CLOSE_BRACKET ||
            token.kind === CLOSE_BRACE
        ) {
            if (depth === 0)
                return { index: i, end: (tokens[i - 1] as Token).end }
            depth -= 1
            continue
        }
        if (depth === 0 && (token.kind === COMMA || token.kind === SEMICOLON))
            return { index: i, end: (tokens[i - 1] as Token).end }
    }
    return {
        index: tokens.length,
        end: (tokens[tokens.length - 1] as Token).end,
    }
}
