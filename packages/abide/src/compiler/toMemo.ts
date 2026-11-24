// 38.215 — THE MIGRATION OFF A BODY HANDED TO `reactive`: every `reactive(…)` whose first argument is
// a function is a `memo(…)` from the release this migration is keyed to on, since `reactive` holds a
// function rather than running it (4.20, 11.74).
//
// A SCAN, NOT A PARSE, as every compiler pass that rewrites source is (`tokenize.ts`): what decides
// the form is the first argument's leading tokens — `(…) =>`, `x =>`, `async`, `function` — and those
// are read off the scanner. A first argument that is only a NAME is a body where the same text binds
// that name to a function, and is left for the checker to name where it does not.

import { SyntaxKind } from 'typescript/unstable/ast'

import { closerOf, type Token, tokenize } from './tokenize.ts'

/** Which grammar `text` is: a TypeScript module, an `.abide` file, or Markdown with code fences. */
type Kind = 'ts' | 'abide' | 'md'

/** 38.215 — `text`, a file at `path`, with each `reactive` handed a body renamed `memo`. */
export function toMemo(text: string, path: string): string {
    const kind: Kind = path.endsWith('.abide')
        ? 'abide'
        : path.endsWith('.md')
          ? 'md'
          : 'ts'
    return migrate(text, kind)
}

function migrate(text: string, kind: Kind): string {
    if (!text.includes('reactive')) return text
    if (kind === 'ts') return migrateModule(text)
    if (kind === 'md')
        return replaceSpans(
            text,
            /^([ \t]*)(```|~~~)([\w-]*)[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm,
            4,
            (inner) => (inner.includes('<script') ? 'abide' : 'ts'),
        )
    // An `.abide` file: its script blocks are modules, and a code sample written in its markup — a
    // template literal handed to a prop — is a file of its own, shown rather than run.
    const migrated = replaceSpans(
        text,
        /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g,
        2,
        () => 'ts',
    )
    return replaceOutsideScripts(migrated)
}

/** Each match's group `group` migrated as the grammar `kindOf` reads it as, the rest kept. */
function replaceSpans(
    text: string,
    pattern: RegExp,
    group: number,
    kindOf: (inner: string) => Kind,
): string {
    let out = ''
    let last = 0
    const indexed = new RegExp(pattern.source, `${pattern.flags}d`)
    for (const match of text.matchAll(indexed)) {
        const inner = match[group] ?? ''
        const start = match.indices?.[group]?.[0] ?? match.index ?? 0
        out += text.slice(last, start)
        out += migrate(inner, kindOf(inner))
        last = start + inner.length
    }
    return out + text.slice(last)
}

/** The template literals an `.abide` file's markup holds, each migrated as the code it shows. */
function replaceOutsideScripts(text: string): string {
    let out = ''
    let last = 0
    for (const script of text.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)) {
        const start = script.index ?? 0
        out += samples(text.slice(last, start))
        out += script[0]
        last = start + script[0].length
    }
    return out + samples(text.slice(last))
}

/** `markup` with each backtick-delimited sample in it migrated. */
function samples(markup: string): string {
    return replaceSpans(markup, /`((?:\\[\s\S]|[^`\\])*)`/g, 1, (inner) =>
        inner.includes('<script') ? 'abide' : 'ts',
    )
}

/** A module's `reactive` calls over a body renamed, and `memo` imported beside `reactive`. */
function migrateModule(text: string): string {
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
    let migrated = text
    for (let index = renames.length - 1; index >= 0; index -= 1) {
        const start = renames[index] as number
        migrated =
            migrated.slice(0, start) +
            'memo' +
            migrated.slice(start + 'reactive'.length)
    }
    migrated = migrateSamples(migrated)
    return withMemoImported(migrated, renames.length > 0)
}

/** The template literals a module holds — a code sample a docs page shows — each migrated. */
function migrateSamples(text: string): string {
    if (!/`[^`]*reactive/.test(text)) return text
    let out = ''
    let last = 0
    for (const token of tokenize(text)) {
        if (
            token.kind !== SyntaxKind.NoSubstitutionTemplateLiteral ||
            !token.text.includes('reactive')
        )
            continue
        const inner = token.text.slice(1, -1)
        out += text.slice(last, token.start + 1)
        out += migrate(inner, inner.includes('<script') ? 'abide' : 'ts')
        last = token.end - 1
    }
    return out + text.slice(last)
}

/** The index past a call's `<…>` type arguments, or `at` where there are none. */
function afterTypeArguments(tokens: Token[], at: number): number {
    if ((tokens[at] as Token | undefined)?.kind !== SyntaxKind.LessThanToken)
        return at
    let depth = 0
    for (let index = at; index < tokens.length; index += 1) {
        const kind = (tokens[index] as Token).kind
        if (kind === SyntaxKind.LessThanToken) depth += 1
        else if (kind === SyntaxKind.GreaterThanToken) depth -= 1
        else if (kind === SyntaxKind.GreaterThanGreaterThanToken) depth -= 2
        else if (kind === SyntaxKind.GreaterThanGreaterThanGreaterThanToken)
            depth -= 3
        if (depth <= 0) return index + 1
    }
    return at
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
 * and in place of it where nothing else in `text` still calls `reactive`.
 */
function withMemoImported(text: string, migrated: boolean): string {
    if (!migrated) return text
    const importPattern = /import\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"])/g
    for (const found of text.matchAll(importPattern)) {
        const list = found[1] as string
        const names = list
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name !== '')
        if (!names.includes('reactive') || names.includes('memo')) continue
        const start = found.index ?? 0
        const rest = text.slice(0, start) + text.slice(start + found[0].length)
        const stillCalled = calls(rest)
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
        const indent = multiline
            ? (/\n([ \t]*)\S/.exec(list)?.[1] ?? '    ')
            : ''
        const rendered = multiline
            ? `{\n${kept.map((name) => `${indent}${name},`).join('\n')}\n}`
            : `{ ${kept.join(', ')} }`
        const replaced = `import ${rendered} from ${found[2]}`
        return (
            text.slice(0, start) +
            replaced +
            text.slice(start + found[0].length)
        )
    }
    return text
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
