import { createScanner, SyntaxKind, tokenIsIdentifierOrKeyword } from 'typescript/unstable/ast'
import type { Root, TemplateNode, TemplateToken, TemplateTokenType } from './ast.ts'
import { parse } from './parse.ts'

// The LSP's highlight tokens for a `.abide` component. Three passes over the same source, all from the
// ONE parse walk:
//   1. MARKUP + block framing (`onToken`): tag/component names, attribute names, quoted values,
//      comments, `< > = /` punctuation, and the `{#…}`/`{:…}`/`{/…}` block framing.
//   2. EXPRESSION interiors (`onExpression`): every brace-delimited expression — `{expr}`
//      interpolations, attribute `={…}` values, spreads, AND block headers (`{#if COND}`, `{#for …}`).
//   3. `<script>` BODIES: the raw TypeScript between `<script>`…`</script>` (and nested branch scripts).
//      Colored by the LSP directly rather than left to the editor's HTML-grammar injection, which is
//      unreliable inside a `.abide` (the HTML tree-sitter parse is derailed by `{#if}`/`{expr}`/`class:x`).
//
// Passes 2 and 3 use TypeScript's own scanner — SYNTACTIC only (no type info): keywords, string/number
// literals, comments, and operators color; plain identifiers stay at the default color, since without
// the checker we can't tell a variable from a function from a property. `<style>` bodies (CSS) are left
// to the editor's injection.
//
// A `.abide` mid-edit is often invalid and `parse` throws on the first error; whatever tokens and spans
// were collected before the failure are still emitted (partial highlighting).
export function templateSemanticTokens(source: string): TemplateToken[] {
    const tokens: TemplateToken[] = []
    const expressions: Array<readonly [number, number]> = []
    let root: Root | null = null
    try {
        root = parse(source, {
            onToken: (token) => tokens.push(token),
            onExpression: (start, end) => expressions.push([start, end]),
        })
    } catch {
        return tokens // partial markup up to the parse error
    }
    for (const [start, end] of expressions) scanCode(source, start, end, tokens)
    for (const script of scriptBodies(root.children)) scanCode(source, script[0], script[1], tokens)
    return tokens
}

// Every `<script>` body's [contentStart, contentEnd) — the root scripts and any nested branch-local ones.
function scriptBodies(nodes: TemplateNode[]): Array<readonly [number, number]> {
    const spans: Array<readonly [number, number]> = []
    const visit = (list: TemplateNode[]): void => {
        for (const node of list) {
            switch (node.type) {
                case 'Script':
                    spans.push([node.contentStart, node.contentEnd])
                    break
                case 'Element':
                case 'Component':
                case 'ForBlock':
                case 'ComponentBlock':
                    visit(node.children)
                    if (node.type === 'ForBlock' && node.catch !== null) visit(node.catch.children)
                    break
                case 'IfBlock':
                    for (const branch of node.branches) visit(branch.children)
                    break
                case 'AwaitBlock':
                    visit(node.pending)
                    if (node.then !== null) visit(node.then.children)
                    if (node.catch !== null) visit(node.catch.children)
                    if (node.finally !== null) visit(node.finally.children)
                    break
                case 'SwitchBlock':
                    visit(node.leading)
                    for (const arm of node.cases) visit(arm.children)
                    break
                case 'TryBlock':
                    visit(node.children)
                    if (node.catch !== null) visit(node.catch.children)
                    if (node.finally !== null) visit(node.finally.children)
                    break
            }
        }
    }
    visit(nodes)
    return spans
}

// Tokenize `source[start, end)` with TypeScript's scanner (trivia kept, so comments color) and push a
// highlight token per keyword, literal, comment, and operator. Bounded defensively on `start` — the
// scanner over-runs the length with empty tokens at the tail rather than stopping cleanly.
function scanCode(source: string, start: number, end: number, out: TemplateToken[]): void {
    if (end <= start) return
    const scanner = createScanner(false, undefined, source, start, end - start)
    // Hard iteration cap: a token is ≥1 char, so a well-behaved scan yields < (end - start) tokens. The
    // cap guarantees termination even if the scanner stalls on malformed mid-edit input (an unterminated
    // literal) — a hung scan here would freeze the whole semantic-tokens request (a real 120s incident).
    const maxTokens = end - start + 1
    let count = 0
    for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
        if (++count > maxTokens) break
        const tokenStart = scanner.getTokenStart()
        if (tokenStart >= end) break
        const tokenEnd = Math.min(scanner.getTokenEnd(), end)
        if (tokenEnd <= tokenStart) continue
        const type = classifyToken(kind)
        if (type !== null) out.push({ start: tokenStart, length: tokenEnd - tokenStart, type })
    }
}

// A scanned token → a highlight type, or null to leave it at the default color (identifiers, whitespace).
// Identifiers are left alone (no type info to tell variable/function/property apart).
function classifyToken(kind: SyntaxKind): TemplateTokenType | null {
    if (kind === SyntaxKind.Identifier || kind === SyntaxKind.PrivateIdentifier) return null
    if (kind === SyntaxKind.SingleLineCommentTrivia || kind === SyntaxKind.MultiLineCommentTrivia)
        return 'comment'
    if (
        kind === SyntaxKind.WhitespaceTrivia ||
        kind === SyntaxKind.NewLineTrivia ||
        kind === SyntaxKind.ConflictMarkerTrivia
    )
        return null
    if (
        kind === SyntaxKind.StringLiteral ||
        kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
        kind === SyntaxKind.TemplateHead ||
        kind === SyntaxKind.TemplateMiddle ||
        kind === SyntaxKind.TemplateTail ||
        kind === SyntaxKind.RegularExpressionLiteral
    )
        return 'string'
    if (kind === SyntaxKind.NumericLiteral || kind === SyntaxKind.BigIntLiteral) return 'number'
    if (tokenIsIdentifierOrKeyword(kind)) return 'keyword' // an Identifier is already handled above
    return 'operator' // punctuation + operators
}
