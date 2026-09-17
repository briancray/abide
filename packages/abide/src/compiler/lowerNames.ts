import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'

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

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i] as Token
        if (token.kind !== IDENTIFIER || !reactive.has(token.text)) continue
        // A member name is not the binding: `obj.n` is a property, `n.set` is the API (31.7).
        const previous = i > 0 ? (tokens[i - 1] as Token) : undefined
        if (previous?.kind === DOT) continue
        if (previous !== undefined && DECLARATION.has(previous.kind)) continue

        // A name at the very end of an expression is the commonest read of all — `{n}` — so an
        // absent next token is a read, not a reason to skip.
        const next = tokens[i + 1] as Token | undefined

        // 31.7 — the explicit spelling keeps compiling. `n()` and `n.set(v)` are already right.
        if (next?.kind === OPEN_PAREN || next?.kind === DOT) continue

        const op = next === undefined ? undefined : OP_ASSIGN.get(next.kind)
        if (next !== undefined && (next.kind === EQUALS || op !== undefined)) {
            const rhs = rightHandSide(tokens, i + 2)
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
    while (true) {
        const kind = scanner.scan()
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

// Where the value being assigned ends: the first `,` or `;` at depth zero, or the bracket that
// closes the region this assignment is inside. `n = f(a, b)` keeps its comma; `[n = 1, 2]` does not.
function rightHandSide(
    tokens: Token[],
    from: number,
): { index: number; end: number } {
    let depth = 0
    for (let i = from; i < tokens.length; i += 1) {
        const token = tokens[i] as Token
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
