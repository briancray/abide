import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner, type Scanner } from 'typescript/unstable/ast/scanner'

// ONE TOKENIZER, read by `splitImports`, `forBlock`, `projectShadow` and `Lowering`, and by
// `parseAbide` through `slotEnd`, which is the same scan. A template literal's re-scan, the
// regex-or-division question and where a slot ends are each answered once, so every reader agrees
// by construction rather than case by case.
//
// A SCANNER SAYS WHERE THE TOKENS ARE, NOT WHAT THEY MEAN, and that is the whole contract — the
// expression grammar is never parsed, which is what keeps 19.11 a property of the file.

export type Token = {
    kind: SyntaxKind
    text: string
    start: number
    end: number
}

/** The tokens of `source`, scanned the way `slotEnd` scans a slot. */
export function tokenize(source: string): Token[] {
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

/**
 * Whether a token of the code scanned from `from` begins at `at` — false where `at` is inside a
 * string, a template, a regex or a comment.
 */
export function startsToken(source: string, from: number, at: number): boolean {
    let found = false
    scan(source, from, (_kind, scanner) => {
        const start = scanner.getTokenStart()
        found = start === at
        return start < at
    })
    return found
}

/**
 * How far `kind` moves the bracket depth a top-level separator is found at: a template's
 * substitutions nest as a call's arguments do, so `${a, b}` holds its comma.
 */
export function nesting(kind: SyntaxKind): number {
    switch (kind) {
        case SyntaxKind.OpenParenToken:
        case SyntaxKind.OpenBracketToken:
        case SyntaxKind.OpenBraceToken:
        case SyntaxKind.TemplateHead:
            return 1
        case SyntaxKind.CloseParenToken:
        case SyntaxKind.CloseBracketToken:
        case SyntaxKind.CloseBraceToken:
        case SyntaxKind.TemplateTail:
            return -1
        default:
            return 0
    }
}

/**
 * The index of the `}` closing the template slot opened at `open`, or the source's length.
 *
 * 32.1 — the same scan `tokenize` makes, so the regex-or-division
 * question, a template literal's substitutions, strings and comments are answered once for both
 * — `{f('}')}`, `{ /* } *\/ x }` and `{xs.filter(s => /}/.test(s))}` end where they read as ending.
 *
 * A CLOSE DIRECTIVE IS THE ONE PLACE THE TEMPLATE'S GRAMMAR OVERRIDES JAVASCRIPT'S. `{/if}`,
 * `{/for}`, `{/try}` — any `/name`, with any whitespace around it — read as a regular expression
 * would run on to the next `/` and take the markup after the block with them. No expression is a
 * bare `/name` either, so the whole shape is the directive rather than a list of block names.
 *
 * AN OPEN DIRECTIVE'S NAME IS SKIPPED, and the scan starts past it expecting an operand:
 * `{#if /'/.test(s)}` opens a literal, where `#if` read as a private name would divide.
 */
export function slotEnd(source: string, open: number): number {
    let first = open + 1
    while (first < source.length && isSpace(source[first] as string)) first += 1
    if (source[first] === '/') {
        let close = first + 1
        while (close < source.length && isLetter(source[close] as string))
            close += 1
        if (close > first + 1) {
            while (close < source.length && isSpace(source[close] as string))
                close += 1
            if (source[close] === '}') return close
        }
    }
    let from = open
    let depth = 0
    if (source[first] === '#') {
        let name = first + 1
        while (name < source.length && isLetter(source[name] as string))
            name += 1
        if (name > first + 1) {
            from = name
            depth = 1
        }
    }
    let end = source.length
    scan(source, from, (kind, scanner) => {
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

/**
 * The tokens after which a `{` opens a body rather than an object literal.
 *
 * A `{` AFTER ONE OF THESE OPENS A BODY even though an operand could stand there — an object
 * literal only follows a token that takes a value. `>` and `void` end a TypeScript return type:
 * `f(): Promise<T> {` and `f(): void {`. What this misses is a `case x: {` block, read as a
 * literal because `:` also precedes an object's value, so a regex opening the statement after
 * that block scans as a division.
 */
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

/**
 * The one scanner `scan` resets per call.
 *
 * ONE SCANNER, reset per call: a scanner is an object of ~50 closures, and `slotEnd` asks once per
 * `{` in a template. Safe because no `visit` scans again before its own scan returns.
 */
const SCANNER = createScanner(true)

/**
 * THE SCAN BOTH READERS SHARE, from `from`, handing each token to `visit` until it answers false.
 */
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
    // rewritten as if it were a read: `${owner} — … of notes` would lower to
    // `${owner())} — … of notes()`, which is not a program.
    //
    // Only a `}` whose opener was the `${` continues the literal, so an object literal in a
    // substitution closes on its own brace.
    const openers: number[] = []
    let previous: SyntaxKind | undefined
    let expectsOperand = true
    while (true) {
        let kind = scanner.scan()
        if (kind === SyntaxKind.EndOfFile) return
        // A `#` NAMING NOTHING scans as an empty private name and the scanner does not move past
        // it, so `{#` typed at the end of a file never finished parsing. It is stepped over.
        if (scanner.getTokenEnd() === scanner.getTokenStart()) {
            scanner.resetTokenState(scanner.getTokenEnd() + 1)
            continue
        }
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

/**
 * Whether `kind` is a contextual keyword, which is a legal binding name.
 *
 * The scanner answers `GetKeyword` for `get` and `TypeKeyword` for `type` wherever they stand.
 */
export function isContextualKeyword(kind: SyntaxKind): boolean {
    return (
        kind >= SyntaxKind.FirstContextualKeyword &&
        kind <= SyntaxKind.LastContextualKeyword
    )
}

/**
 * A NAME, A LITERAL OR A VALUE KEYWORD ENDS AN OPERAND, so a `/` after it divides. A contextual
 * keyword is a name — `type / 2`, `get / 2` — except the two that take an operand after them,
 * `await` and `of`, after which a `/` opens a literal.
 */
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

/**
 * Whether `char` is HTML's ASCII whitespace.
 *
 * HTML's ASCII WHITESPACE — every position this is asked about is template grammar, not
 * JavaScript's, and `\s` answers yes to a no-break space the HTML tokenizer keeps as text.
 */
export function isSpace(char: string): boolean {
    return (
        char === ' ' ||
        char === '\t' ||
        char === '\n' ||
        char === '\f' ||
        char === '\r'
    )
}

/**
 * The index just past the CSS string opening at `open`.
 *
 * A `;` or a `:` inside one is the value's own.
 */
export function skipQuoted(source: string, open: number): number {
    const quote = source[open]
    let at = open + 1
    while (at < source.length) {
        const char = source[at]
        if (char === '\\') {
            at += 2
            continue
        }
        if (char === quote) return at + 1
        at += 1
    }
    return at
}

/** A block name is lower-case ASCII. */
function isLetter(char: string): boolean {
    return char >= 'a' && char <= 'z'
}
