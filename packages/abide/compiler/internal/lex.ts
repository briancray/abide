// The one tokenizer, borrowed from the real compiler.
//
// Everything downstream — where an embedded expression ENDS, which identifier is a read and which is
// a write — is a question about JavaScript tokens, and a `.abide` file must not answer it with its
// own hand-rolled brace counter. `{ user.name.includes('}') }` and `` {`a${b}c`} `` are the cases a
// counter gets wrong, and they are ordinary authoring, not edge cases. So this wraps TypeScript 7's
// own scanner and adds the two rescans a bare scanner cannot decide for itself:
//
//   template  a `}` may be the end of a `${...}` substitution rather than a close brace, and only the
//             consumer's depth bookkeeping knows which — so the scanner is asked to re-read it.
//   regex     `/` is division after something that can END an expression and a regex otherwise. The
//             scanner defers this to the parser; there is no parser here, so the standard
//             previous-token rule stands in for one.
//
// Depth is tracked HERE rather than by each consumer because both rescans depend on it, and two
// consumers keeping their own count is two chances to disagree about what `}` meant.

import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast'

export interface Token {
    kind: SyntaxKind
    /** Offset of the token itself, trivia excluded. */
    start: number
    end: number
    /** Brace depth AFTER this token — so the `}` that closes depth 1 reports 0. */
    depth: number
    /** The token's own source text. Identifiers are compared by it, so it is never recomputed. */
    text: string
    /**
     * A line break sits between this token and the one before it.
     *
     * The scanner's own answer rather than a second scan for `\n`: this is what ASI is decided on,
     * and in a codebase written without semicolons it is the only thing that says where a statement
     * ended. See `assignmentEnd` in `desugar.ts` and `startsStatement` in `types.ts` — the two
     * consumers.
     */
    startsLine: boolean
}

// A `/` directly after one of these is division; after anything else it opens a regex. Keywords are
// listed by kind rather than by text because the scanner has already classified them.
//
// Exported because it answers a second question with the same shape — "could an expression have
// ENDED here" — which is half of what decides where a statement written without a semicolon does.
export const ENDS_EXPRESSION = new Set<SyntaxKind>([
    SyntaxKind.Identifier,
    SyntaxKind.PrivateIdentifier,
    SyntaxKind.NumericLiteral,
    SyntaxKind.BigIntLiteral,
    SyntaxKind.StringLiteral,
    SyntaxKind.RegularExpressionLiteral,
    SyntaxKind.NoSubstitutionTemplateLiteral,
    SyntaxKind.TemplateTail,
    SyntaxKind.CloseParenToken,
    SyntaxKind.CloseBracketToken,
    SyntaxKind.CloseBraceToken,
    SyntaxKind.PlusPlusToken,
    SyntaxKind.MinusMinusToken,
    SyntaxKind.ThisKeyword,
    SyntaxKind.SuperKeyword,
    SyntaxKind.TrueKeyword,
    SyntaxKind.FalseKeyword,
    SyntaxKind.NullKeyword,
])

export class SyntaxError_ extends Error {
    constructor(
        message: string,
        readonly position: number,
    ) {
        super(message)
        this.name = 'AbideSyntaxError'
    }
}

/**
 * ONE scanner for the whole compiler, not one per `Lexer`.
 *
 * TypeScript's `createScanner` hands back several dozen closures over a single scope, and a `Lexer`
 * is built per AST node — per `{…}` hole, per attribute value, per block header, per desugared
 * expression. That was 56 of the 58 `Function` objects a compiled AST node allocated, and sharing it
 * takes a whole compile down by ~1.1x on its own.
 *
 * WHAT MAKES IT SAFE, and it is a property of the call sites rather than of this file: every
 * `new Lexer` (four of them — `tokensOf` and `readExpression` here, `desugar.ts`'s `tokenize`,
 * `emit.ts`'s `regionTokens`) is immediately followed by a synchronous `for(;;)` whose body calls
 * only `lexer.next()`, so no `Lexer` is ever alive across a call that could construct another. The
 * constructor's `setText` resets this, which is also what makes a `Lexer` abandoned by a thrown
 * `ParseError` harmless. A new `new Lexer` whose loop grows a call is what would break it — that is
 * the one grep to run before adding one.
 */
const SCANNER = createScanner(true, LanguageVariant.Standard, '')

export class Lexer {
    private readonly scanner = SCANNER
    private previous: SyntaxKind = SyntaxKind.Unknown
    /** Depths at which a `${` is open, so the matching `}` is re-read as template text. */
    private readonly substitutions: number[] = []
    depth = 0

    constructor(
        private readonly source: string,
        from: number,
        depth = 0,
    ) {
        this.scanner.setText(source, from)
        this.depth = depth
    }

    /** The next token, or `null` at end of input. */
    next(): Token | null {
        let kind = this.scanner.scan()
        if (kind === SyntaxKind.EndOfFile) return null

        if (kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) {
            if (!ENDS_EXPRESSION.has(this.previous)) kind = this.scanner.reScanSlashToken()
        } else if (kind === SyntaxKind.OpenBraceToken) {
            this.depth++
        } else if (kind === SyntaxKind.CloseBraceToken) {
            const substitution = this.substitutions[this.substitutions.length - 1]
            if (substitution === this.depth) {
                // Not a close brace at all — the tail of a `${...}` inside a template literal.
                kind = this.scanner.reScanTemplateToken(false)
                if (kind === SyntaxKind.TemplateTail) {
                    this.substitutions.pop()
                    this.depth--
                }
            } else {
                this.depth--
            }
        }

        if (kind === SyntaxKind.TemplateHead) {
            // `${` behaves as an open brace: its matching `}` is what resumes the template.
            this.depth++
            this.substitutions.push(this.depth)
        }

        if (this.scanner.isUnterminated()) {
            throw new SyntaxError_(
                `abide: unterminated ${kind === SyntaxKind.StringLiteral ? 'string' : 'literal'}`,
                this.scanner.getTokenStart(),
            )
        }

        this.previous = kind
        const start = this.scanner.getTokenStart()
        const end = this.scanner.getTokenEnd()
        return {
            kind,
            start,
            end,
            depth: this.depth,
            text: this.source.slice(start, end),
            startsLine: this.scanner.hasPrecedingLineBreak(),
        }
    }
}

/**
 * Every token in a source, once.
 *
 * For the consumer that has to look BACKWARD as well as forward — a type annotation is read after
 * the endpoint that owns it is recognised, and a local `interface` it names may be declared further
 * down the file. Streaming cannot answer either without a second pass, and a transport module is a
 * handful of declarations.
 */
export function tokensOf(source: string): Token[] {
    const lexer = new Lexer(source, 0)
    const tokens: Token[] = []
    for (;;) {
        const token = lexer.next()
        if (token === null) return tokens
        tokens.push(token)
    }
}

/**
 * Read the expression that opened at `start` (the offset of its `{`), returning the text between the
 * braces and the offset of the closing `}`.
 */
export function readExpression(source: string, start: number): { text: string; end: number } {
    const lexer = new Lexer(source, start + 1, 1)
    for (;;) {
        const token = lexer.next()
        if (token === null) {
            throw new SyntaxError_('abide: unterminated `{` — no matching `}`', start)
        }
        if (token.kind === SyntaxKind.CloseBraceToken && token.depth === 0) {
            return { text: source.slice(start + 1, token.start), end: token.start }
        }
    }
}
