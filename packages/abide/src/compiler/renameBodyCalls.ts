// THE RENAMING `abide upgrade` MAKES OF A FACTORY HANDED A BODY: each call of one name whose first
// argument passes a test becomes a call of another, imported beside the first. `toMemo` (38.215)
// and `toComputed` (38.223) are its two uses.
//
// A SCAN, NOT A PARSE, as every compiler pass that rewrites source is (`tokenize.ts`): what decides
// the form is the first argument's leading tokens — `(…) =>`, `x =>`, `async`, `function` — and those
// are read off the scanner. A first argument that is only a NAME is a body where the same text binds
// that name to a function, and is left for the checker to name where it does not.

import { SyntaxKind } from 'typescript/unstable/ast'

import { abideBindings, isAbideSpecifier, localOf } from './hookCalls.ts'
import { type CodeRewrite, type Splice, spliced } from './rewriteCode.ts'
import {
    type ImportStatement,
    importStatements,
    namedImports,
} from './splitImports.ts'
import {
    afterTypeArguments,
    closerOf,
    type Token,
    tokenize,
} from './tokenize.ts'

/**
 * The rewrite renaming each `from` call `accepts` to `to`, and importing `to` beside abide's `from`
 * wherever one was renamed.
 */
export function renameBodyCalls(
    from: string,
    to: string,
    accepts: (tokens: Token[], at: number, text: string) => boolean,
): CodeRewrite {
    const renamedIn = (code: string) => renamedCalls(code, from, to, accepts)
    const importedIn = (code: string, migrated: boolean, elsewhere: string) =>
        withImported(code, migrated, elsewhere, from, to)
    return {
        word: from,
        module: (code) => {
            const renamed = renamedIn(code)
            return importedIn(renamed.code, renamed.count > 0, '')
        },
        // A PAGE'S SCRIPTS ARE ONE SCOPE: a nested per-arm `<script>` reads the top-level one's imports,
        // so `to` goes beside the `from` the page imports wherever a body was renamed, and `from` stays
        // imported while any script still calls it.
        scripts: (blocks) => {
            const renamed = blocks.map(renamedIn)
            const codes = renamed.map((block) => block.code)
            let migrated = false
            for (const block of renamed) if (block.count > 0) migrated = true
            if (!migrated) return codes
            for (let index = 0; index < codes.length; index += 1) {
                const code = codes[index] as string
                const others = codes.filter((_, other) => other !== index)
                const imported = importedIn(code, true, others.join('\n'))
                codes[index] = imported
                // The first script importing `from` is the one `to` joins, even where it already has.
                if (
                    imported !== code ||
                    localOf(abideBindings([code]), from) !== undefined
                )
                    break
            }
            return codes
        },
    }
}

/** A module's `from` calls `accepts` renamed `to`, and how many were. */
function renamedCalls(
    text: string,
    from: string,
    to: string,
    accepts: (tokens: Token[], at: number, text: string) => boolean,
): { code: string; count: number } {
    const tokens = tokenize(text)
    const renames: number[] = []
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind === SyntaxKind.NoSubstitutionTemplateLiteral) continue
        if (token.text !== from) continue
        const before = tokens[at - 1]
        if (before?.kind === SyntaxKind.DotToken) continue
        const open = afterTypeArguments(tokens, at + 1)
        if (
            (tokens[open] as Token | undefined)?.kind !==
            SyntaxKind.OpenParenToken
        )
            continue
        if (accepts(tokens, open + 1, text)) renames.push(token.start)
    }
    const edits: Splice[] = []
    for (const start of renames)
        edits.push({ start, end: start + from.length, text: to })
    return { code: spliced(text, edits), count: renames.length }
}

/**
 * Whether the argument starting at `at` is a body: one written in place, or a bare name `text` binds
 * to one. A member (`feed.body`) is left for the checker, whose value only it knows.
 */
export function isBody(tokens: Token[], at: number, text: string): boolean {
    const first = tokens[at] as Token | undefined
    if (first === undefined) return false
    if (first.kind === SyntaxKind.FunctionKeyword) return true
    if (first.text === 'async') {
        const next = tokens[at + 1] as Token | undefined
        if (
            next?.kind === SyntaxKind.FunctionKeyword ||
            next?.kind === SyntaxKind.OpenParenToken ||
            (next?.kind === SyntaxKind.Identifier &&
                tokens[at + 2]?.kind === SyntaxKind.EqualsGreaterThanToken)
        )
            return true
    }
    if (first.kind === SyntaxKind.OpenParenToken) {
        return closesArrow(tokens, closerOf(tokens, at))
    }
    if (first.kind === SyntaxKind.LessThanToken) return true
    if (first.kind === SyntaxKind.Identifier) {
        const next = tokens[at + 1] as Token | undefined
        if (next?.kind === SyntaxKind.EqualsGreaterThanToken) return true
        if (
            next?.kind === SyntaxKind.CloseParenToken ||
            next?.kind === SyntaxKind.CommaToken
        )
            return bindsFunction(text, first.text, first.start)
    }
    return false
}

/** Whether the `)` at `close` ends an arrow's parameters: `=>` follows it, or a return type's `:`. */
export function closesArrow(tokens: Token[], close: number): boolean {
    if (close === -1) return false
    const after = tokens[close + 1]
    return (
        after?.kind === SyntaxKind.EqualsGreaterThanToken ||
        after?.kind === SyntaxKind.ColonToken
    )
}

/**
 * Whether the declaration of `name` nearest before `before` in `text` binds it to a function: a
 * function declaration, or a `const`, `let` or `var` given one written in place. The nearest, since
 * one file declares the same name in many scopes — a test file's `rows` is a value in one test and a
 * body in the next.
 */
function bindsFunction(text: string, name: string, before: number): boolean {
    const escaped = name.replace(/[$]/g, '\\$')
    const declaration = new RegExp(
        `\\b(?:function\\*?\\s+${escaped}\\b|(?:const|let|var)\\s+${escaped}\\s*(?::[^=;]+)?=\\s*(?:async\\s*)?(function\\b|\\(|[\\w$]+\\s*=>)?)`,
        'g',
    )
    let nearest: RegExpExecArray | undefined
    for (const found of text.slice(0, before).matchAll(declaration))
        nearest = found
    if (nearest === undefined) return false
    if (nearest[0].startsWith('function')) return true
    const bound = nearest[1]
    if (bound === undefined) return false
    if (bound !== '(') return true
    // `(` opens an arrow's parameters or a parenthesized value: an arrow's close is followed by `=>`.
    const tokens = tokenize(
        text.slice((nearest.index ?? 0) + nearest[0].length - 1),
    )
    return closesArrow(tokens, closerOf(tokens, 0))
}

/**
 * `text` with `to` imported wherever it was migrated: beside `from` in the import naming it, and in
 * place of it where nothing else in `text`, nor in `elsewhere` — the code sharing its scope — still
 * calls `from`.
 */
function withImported(
    text: string,
    migrated: boolean,
    elsewhere: string,
    from: string,
    to: string,
): string {
    if (!migrated) return text
    const statement = importOf(text, from, to)
    if (statement === undefined) return text
    const names = statement.bindings.map((binding) => binding.written)
    const rest = text.slice(0, statement.start) + text.slice(statement.end)
    const stillCalled = calls(rest, from) || calls(elsewhere, from)
    const kept = stillCalled ? names : names.filter((name) => name !== from)
    kept.push(to)
    const list = namedImports(text, statement, kept)
    return text.slice(0, list.start) + list.text + text.slice(list.end)
}

/**
 * The statement importing abide's `from` by its own name in braces alone, where `to` is not imported
 * beside it — the one `to` joins. An app's own `from`, from any other module, is not.
 */
function importOf(
    text: string,
    from: string,
    to: string,
): ImportStatement | undefined {
    for (const statement of importStatements(text)) {
        if (statement.typeOnly || !isAbideSpecifier(statement.specifier))
            continue
        let named = false
        let other = false
        for (const binding of statement.bindings) {
            if (binding.imported === 'default' || binding.imported === '*')
                other = true
            else if (binding.imported === to) other = true
            else if (binding.written === from) named = true
        }
        if (named && !other) return statement
    }
    return undefined
}

/** Whether `text` names `name` in code — not in a comment or a string, nor as a member. */
function calls(text: string, name: string): boolean {
    if (!text.includes(name)) return false
    const tokens = tokenize(text)
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (
            token.kind === SyntaxKind.Identifier &&
            token.text === name &&
            tokens[at - 1]?.kind !== SyntaxKind.DotToken
        )
            return true
    }
    return false
}
