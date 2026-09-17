import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'

// A `<script>` block is per-instance setup (34.1), so its body is emitted INSIDE the component
// function — but an `import` is only legal at the top of a module. This splits the two so the
// imports can be hoisted and everything else stays where the author put it.
//
// A dynamic `import(...)` is an expression, not a declaration, and stays in the body.
export function splitImports(script: string): {
    imports: string
    body: string
} {
    const scanner = createScanner(true, undefined, script)
    const spans: { start: number; end: number }[] = []
    let depth = 0
    let start = -1
    let awaitingSpecifier = false

    while (true) {
        const kind = scanner.scan()
        if (kind === SyntaxKind.EndOfFile) break

        // Inside an import clause the braces are the clause's own and are balanced, so depth is
        // left alone until the specifier lands. This case comes FIRST: written after the bracket
        // handling below, the `import(` check is unreachable, because a paren continues there.
        if (awaitingSpecifier) {
            if (kind === SyntaxKind.OpenParenToken) {
                // `import(...)` is an expression, not a declaration, and stays in the body.
                awaitingSpecifier = false
                depth += 1
                continue
            }
            if (kind === SyntaxKind.StringLiteral) {
                spans.push({ start, end: scanner.getTokenEnd() })
                awaitingSpecifier = false
            }
            continue
        }

        if (
            kind === SyntaxKind.OpenBraceToken ||
            kind === SyntaxKind.OpenParenToken ||
            kind === SyntaxKind.OpenBracketToken
        ) {
            depth += 1
            continue
        }
        if (
            kind === SyntaxKind.CloseBraceToken ||
            kind === SyntaxKind.CloseParenToken ||
            kind === SyntaxKind.CloseBracketToken
        ) {
            depth -= 1
            continue
        }

        if (depth === 0 && kind === SyntaxKind.ImportKeyword) {
            start = scanner.getTokenStart()
            awaitingSpecifier = true
        }
    }

    if (spans.length === 0) return { imports: '', body: script }

    let imports = ''
    let body = ''
    let at = 0
    for (const span of spans) {
        imports += `${script.slice(span.start, span.end)}\n`
        body += script.slice(at, span.start)
        at = span.end
        // The `;` an import may end with would otherwise be left behind as a stray statement.
        if (script[at] === ';') at += 1
    }
    return { imports, body: body + script.slice(at) }
}
