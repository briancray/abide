// 38.215 — THE MIGRATION OFF A BODY HANDED TO `reactive`: every `reactive(…)` whose first argument is
// a function is a `memo(…)` from the release this migration is keyed to on, since `reactive` holds a
// function rather than running it (4.20, 11.74).
//
// A SCAN, NOT A PARSE, as every compiler pass that rewrites source is (`tokenize.ts`): what decides
// the form is the first argument's leading tokens — `(…) =>`, `x =>`, `async`, `function` — and those
// are read off the scanner. A first argument that is only a NAME is a body where the same text binds
// that name to a function, and is left for the checker to name where it does not.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isAbideSpecifier } from './hookCalls.ts'
import { type CodeRewrite, rewriteCode } from './rewriteCode.ts'
import { type ImportStatement, importStatements } from './splitImports.ts'
import {
    afterTypeArguments,
    closerOf,
    type Token,
    tokenize,
} from './tokenize.ts'

/** 38.215 — `text`, a file at `path`, with each `reactive` handed a body renamed `memo`. */
export function toMemo(text: string, path: string): string {
    return rewriteCode(text, path, TO_MEMO)
}

const TO_MEMO: CodeRewrite = {
    word: 'reactive',
    module: (code) => {
        const renamed = renamedToMemo(code)
        return withMemoImported(renamed.code, renamed.count > 0, '')
    },
    // A PAGE'S SCRIPTS ARE ONE SCOPE: a nested per-arm `<script>` reads the top-level one's imports,
    // so `memo` goes beside the `reactive` the page imports wherever a body was renamed, and
    // `reactive` stays imported while any script still calls it.
    scripts: (blocks) => {
        const renamed = blocks.map(renamedToMemo)
        const codes = renamed.map((block) => block.code)
        let migrated = false
        for (const block of renamed) if (block.count > 0) migrated = true
        if (!migrated) return codes
        for (let index = 0; index < codes.length; index += 1) {
            const code = codes[index] as string
            const others = codes.filter((_, other) => other !== index)
            const imported = withMemoImported(code, true, others.join('\n'))
            codes[index] = imported
            // The first script importing `reactive` is the one `memo` joins, even where it already has.
            if (imported !== code || importsReactive(code)) break
        }
        return codes
    },
}

/** Whether `code` imports abide's `reactive`. */
function importsReactive(code: string): boolean {
    for (const statement of importStatements(code))
        if (isAbideSpecifier(statement.specifier))
            for (const binding of statement.bindings)
                if (binding.imported === 'reactive') return true
    return false
}

/** A module's `reactive` calls over a body renamed `memo`, and how many were. */
function renamedToMemo(text: string): { code: string; count: number } {
    const tokens = tokenize(text)
    const renames: number[] = []
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind === SyntaxKind.NoSubstitutionTemplateLiteral) continue
        if (token.text !== 'reactive') continue
        const before = tokens[at - 1]
        if (before?.kind === SyntaxKind.DotToken) continue
        const open = afterTypeArguments(tokens, at + 1)
        if (
            (tokens[open] as Token | undefined)?.kind !==
            SyntaxKind.OpenParenToken
        )
            continue
        if (isBody(tokens, open + 1, text)) renames.push(token.start)
    }
    let code = text
    for (let index = renames.length - 1; index >= 0; index -= 1) {
        const start = renames[index] as number
        code =
            code.slice(0, start) +
            'memo' +
            code.slice(start + 'reactive'.length)
    }
    return { code, count: renames.length }
}

/**
 * Whether the argument starting at `at` is a body: one written in place, or a bare name `text` binds
 * to one. A member (`feed.body`) is left for the checker, whose value only it knows.
 */
function isBody(tokens: Token[], at: number, text: string): boolean {
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
function closesArrow(tokens: Token[], close: number): boolean {
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
 * `text` with `memo` imported wherever it was migrated: beside `reactive` in the import naming it,
 * and in place of it where nothing else in `text`, nor in `elsewhere` — the code sharing its scope —
 * still calls `reactive`.
 */
function withMemoImported(
    text: string,
    migrated: boolean,
    elsewhere: string,
): string {
    if (!migrated) return text
    const statement = reactiveImport(text)
    if (statement === undefined) return text
    const open = text.indexOf('{', statement.start)
    const close = text.indexOf('}', open)
    const list = text.slice(open + 1, close)
    const names = statement.bindings.map((binding) => binding.written)
    const rest = text.slice(0, statement.start) + text.slice(statement.end)
    const stillCalled = calls(rest) || calls(elsewhere)
    const kept = stillCalled
        ? names
        : names.filter((name) => name !== 'reactive')
    kept.push('memo')
    kept.sort((a, b) =>
        a
            .replace(/^type\s+/, '')
            .localeCompare(b.replace(/^type\s+/, ''), 'en', {
                sensitivity: 'base',
            }),
    )
    const multiline = list.includes('\n')
    const indent = multiline ? (/\n([ \t]*)\S/.exec(list)?.[1] ?? '    ') : ''
    const rendered = multiline
        ? `{\n${kept.map((name) => `${indent}${name},`).join('\n')}\n}`
        : `{ ${kept.join(', ')} }`
    return text.slice(0, open) + rendered + text.slice(close + 1)
}

/**
 * The statement importing abide's `reactive` by its own name in braces alone, where `memo` is not
 * imported beside it — the one `memo` joins. An app's own `reactive`, from any other module, is not.
 */
function reactiveImport(text: string): ImportStatement | undefined {
    for (const statement of importStatements(text)) {
        if (statement.typeOnly || !isAbideSpecifier(statement.specifier))
            continue
        let reactive = false
        let other = false
        for (const binding of statement.bindings) {
            if (binding.imported === 'default' || binding.imported === '*')
                other = true
            else if (binding.imported === 'memo') other = true
            else if (binding.written === 'reactive') reactive = true
        }
        if (reactive && !other) return statement
    }
    return undefined
}

/** Whether `text` names `reactive` in code — not in a comment or a string, nor as a member. */
function calls(text: string): boolean {
    if (!text.includes('reactive')) return false
    const tokens = tokenize(text)
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (
            token.kind === SyntaxKind.Identifier &&
            token.text === 'reactive' &&
            tokens[at - 1]?.kind !== SyntaxKind.DotToken
        )
            return true
    }
    return false
}
