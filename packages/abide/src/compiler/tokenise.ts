import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner, type Scanner } from 'typescript/unstable/ast/scanner'

// ONE TOKENISER, read by `splitImports`, `forBlock` and `Lowering`'s slot `raw`, and by `slotEnd`
// through the same scan. Two of them was two answers to the same question and they
// drifted: a template re-scan written for one reader and never for the split left every import
// after a template literal inside the component body, and the emitted module did not parse.
//
// `parseAbide` reads where a template SLOT ends through `slotEnd` below, the same scan — a second,
// character-level scanner beside this one answered the regex-or-division question a second way,
// and the two agreed case by case rather than by construction.
//
// A SCANNER SAYS WHERE THE TOKENS ARE, NOT WHAT THEY MEAN, and that is the whole contract — the
// expression grammar is never parsed, which is what keeps 19.12 a property of the file.

export type Token = {
    kind: SyntaxKind
    text: string
    start: number
    end: number
}

export function tokenise(source: string): Token[] {
    const tokens: Token[] = []
    scan(source, 0, (kind, scanner) => {
        tokens.push({
            kind,
            text: scanner.getTokenText(),
            start: scanner.getTokenStart(),
            end: scanner.getTokenEnd(),
        })
        return true
    })
    return tokens
}

// 32.1 — WHERE A TEMPLATE SLOT OPENED AT `open` ENDS: the index of its closing `}`, or the length
// of the source where it never closes. The same scan `tokenise` makes, so the regex-or-division
// question, a template literal's substitutions, strings and comments are answered once for both
// — `{f('}')}`, `{ /* } */ x }` and `{xs.filter(s => /}/.test(s))}` end where they read as ending.
//
// A CLOSE DIRECTIVE IS THE ONE PLACE THE TEMPLATE'S GRAMMAR OVERRIDES JAVASCRIPT'S. `{/if}` and
// `{/for}` — with any whitespace around the name — read as a regular expression would run on to
// the next `/` and take the markup after the block with them.
export function slotEnd(source: string, open: number): number {
    let first = open + 1
    while (first < source.length && isSpace(source[first] as string)) first += 1
    const directive = source.startsWith('/if', first)
        ? first + 3
        : source.startsWith('/for', first)
          ? first + 4
          : -1
    if (directive !== -1) {
        let close = directive
        while (close < source.length && isSpace(source[close] as string))
            close += 1
        if (source[close] === '}') return close
    }
    let depth = 0
    let end = source.length
    scan(source, open, (kind, scanner) => {
        if (kind === SyntaxKind.OpenBraceToken) depth += 1
        else if (kind === SyntaxKind.CloseBraceToken) {
            depth -= 1
            if (depth === 0) {
                end = scanner.getTokenStart()
                return false
            }
        }
        return true
    })
    return end
}

// A `/` IS A REGEX OR A DIVISION AND THE SCANNER CANNOT TELL, so it answers `SlashToken` and the
// scan decides: a literal where an OPERAND IS EXPECTED, a division where one just ended. One token
// of lookback cannot say which after a closer — `(a) / b` divides and `if (x) /re/` does not — so
// each opener is tagged, when it is read, with what its closer hands back: the tokenizer-context
// approach acorn and sweet.js take, which reads brackets and never the expression grammar.
const OPERAND = 0 // `)` `]` and an object literal's `}` end a value
const STATEMENT = 1 // `)` of `if`/`while`/`for`/`with` and a block's `}` are followed by a statement
const SUBSTITUTION = 2 // `${`, whose `}` continues the template literal

// A `{` AFTER ONE OF THESE OPENS A BODY even though an operand could stand there — an object
// literal only follows a token that takes a value. `>` and `void` end a TypeScript return type:
// `f(): Promise<T> {` and `f(): void {`. What this misses is a `case x: {` block, read as a
// literal because `:` also precedes an object's value, so a regex opening the statement after
// that block scans as a division.
const BODY_AFTER = new Set<SyntaxKind | undefined>([
    undefined,
    SyntaxKind.SemicolonToken,
    SyntaxKind.CloseParenToken,
    SyntaxKind.OpenBraceToken,
    SyntaxKind.CloseBraceToken,
    SyntaxKind.EqualsGreaterThanToken,
    SyntaxKind.GreaterThanToken,
    SyntaxKind.VoidKeyword,
    SyntaxKind.ElseKeyword,
    SyntaxKind.DoKeyword,
    SyntaxKind.TryKeyword,
    SyntaxKind.CatchKeyword,
    SyntaxKind.FinallyKeyword,
])

// THE SCAN BOTH READERS SHARE, from `from`, handing each token to `visit` until it answers false.
// ONE SCANNER, reset per call: a scanner is an object of ~50 closures, and `slotEnd` asks once per
// `{` in a template. Safe because no `visit` scans again before its own scan returns.
const SCANNER = createScanner(true)

function scan(
    source: string,
    from: number,
    visit: (kind: SyntaxKind, scanner: Scanner) => boolean,
): void {
    const scanner = SCANNER
    scanner.setText(source, from)
    // A TEMPLATE LITERAL IS NOT ORDINARY TOKENS. `` `a${b}c` `` scans as TemplateHead, then `b`,
    // then a CLOSE BRACE that has to be RE-SCANNED as the literal's continuation — without that
    // the scanner reads `c\`` as ordinary code, and a bare word in the TEXT of a template gets
    // rewritten as if it were a read. Found by compiling the corpus: `${owner} — … of notes`
    // lowered to `${owner())} — … of notes()`, which is not a program.
    //
    // Only a `}` whose opener was the `${` continues the literal, so an object literal in a
    // substitution closes on its own brace.
    const openers: number[] = []
    let previous: SyntaxKind | undefined
    let expectsOperand = true
    while (true) {
        let kind = scanner.scan()
        if (kind === SyntaxKind.EndOfFile) return
        if (
            expectsOperand &&
            (kind === SyntaxKind.SlashToken ||
                kind === SyntaxKind.SlashEqualsToken)
        )
            kind = scanner.reScanSlashToken()
        else if (
            kind === SyntaxKind.CloseBraceToken &&
            openers[openers.length - 1] === SUBSTITUTION
        )
            kind = scanner.reScanTemplateToken(false)
        // A KEYWORD AFTER A `.` IS A MEMBER NAME — `row.type / 2`, `obj.in / 2`, `x.if(a) / 2`.
        const read =
            (previous === SyntaxKind.DotToken ||
                previous === SyntaxKind.QuestionDotToken) &&
            kind >= SyntaxKind.FirstKeyword &&
            kind <= SyntaxKind.LastKeyword
                ? SyntaxKind.Identifier
                : kind
        switch (read) {
            case SyntaxKind.OpenParenToken:
                openers.push(
                    previous === SyntaxKind.IfKeyword ||
                        previous === SyntaxKind.WhileKeyword ||
                        previous === SyntaxKind.ForKeyword ||
                        previous === SyntaxKind.WithKeyword
                        ? STATEMENT
                        : OPERAND,
                )
                expectsOperand = true
                break
            case SyntaxKind.OpenBraceToken:
                openers.push(
                    !expectsOperand || BODY_AFTER.has(previous)
                        ? STATEMENT
                        : OPERAND,
                )
                expectsOperand = true
                break
            case SyntaxKind.OpenBracketToken:
                openers.push(OPERAND)
                expectsOperand = true
                break
            case SyntaxKind.TemplateHead:
                openers.push(SUBSTITUTION)
                expectsOperand = true
                break
            case SyntaxKind.CloseParenToken:
            case SyntaxKind.CloseBraceToken:
            case SyntaxKind.CloseBracketToken:
            case SyntaxKind.TemplateTail:
                expectsOperand = openers.pop() === STATEMENT
                break
            // PREFIX OR POSTFIX, THESE LEAVE THE QUESTION WHERE IT WAS: a prefix `!` stands where an
            // operand was expected and one still is, a postfix `x!` or `x++` follows one and ends it.
            case SyntaxKind.ExclamationToken:
            case SyntaxKind.PlusPlusToken:
            case SyntaxKind.MinusMinusToken:
                break
            default:
                expectsOperand = !endsOperand(read)
        }
        previous = read
        if (!visit(kind, scanner)) return
    }
}

// Every contextual keyword is a legal binding name, and the scanner answers `GetKeyword` for `get`
// and `TypeKeyword` for `type` wherever they stand.
export function isContextualKeyword(kind: SyntaxKind): boolean {
    return (
        kind >= SyntaxKind.FirstContextualKeyword &&
        kind <= SyntaxKind.LastContextualKeyword
    )
}

// A NAME, A LITERAL OR A VALUE KEYWORD ENDS AN OPERAND, so a `/` after it divides. A contextual
// keyword is a name — `type / 2`, `get / 2` — except the two that take an operand after them,
// `await` and `of`, after which a `/` opens a literal.
function endsOperand(kind: SyntaxKind): boolean {
    if (
        kind >= SyntaxKind.FirstLiteralToken &&
        kind <= SyntaxKind.LastLiteralToken
    )
        return true
    if (isContextualKeyword(kind))
        return kind !== SyntaxKind.AwaitKeyword && kind !== SyntaxKind.OfKeyword
    return (
        kind === SyntaxKind.Identifier ||
        kind === SyntaxKind.PrivateIdentifier ||
        kind === SyntaxKind.ThisKeyword ||
        kind === SyntaxKind.SuperKeyword ||
        kind === SyntaxKind.TrueKeyword ||
        kind === SyntaxKind.FalseKeyword ||
        kind === SyntaxKind.NullKeyword
    )
}

// HTML's ASCII WHITESPACE — every position this is asked about is template grammar, not
// JavaScript's, and `\s` answers yes to a no-break space the HTML tokenizer keeps as text.
export function isSpace(char: string): boolean {
    return (
        char === ' ' ||
        char === '\t' ||
        char === '\n' ||
        char === '\f' ||
        char === '\r'
    )
}
