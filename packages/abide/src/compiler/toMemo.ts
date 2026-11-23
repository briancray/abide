// 38.215 — THE MIGRATION OFF A BODY HANDED TO `reactive`: every `reactive(…)` whose first argument is
// a function is a `memo(…)` from the release this migration is keyed to on, since `reactive` holds a
// function rather than running it (4.20, 11.74).
//
// A SCAN, NOT A PARSE, as every compiler pass that rewrites source is (`tokenize.ts`): what decides
// the form is the first argument's leading tokens — `(…) =>`, `x =>`, `async`, `function` — and those
// are read off the scanner. A first argument that is only a NAME is a body where the same text binds
// that name to a function, and is left for the checker to name where it does not.

import { SyntaxKind } from 'typescript/unstable/ast'

import { type Token, tokenize } from './tokenize.ts'

/** A file's text with every body-form `reactive` renamed, and the lines of the calls left unread. */
export type MemoMigration = { text: string; unread: number[] }

/** Which grammar `text` is: a TypeScript module, an `.abide` file, or Markdown with code fences. */
type Kind = 'ts' | 'abide' | 'md'

/** 38.215 — `text`, a file at `path`, with each `reactive` handed a body renamed `memo`. */
export function toMemo(text: string, path: string): MemoMigration {
    const kind: Kind = path.endsWith('.abide')
        ? 'abide'
        : path.endsWith('.md')
          ? 'md'
          : 'ts'
    const unreadAt: number[] = []
    const migrated = migrate(text, kind, 0, unreadAt)
    const unread: number[] = []
    for (const offset of unreadAt) unread.push(lineAt(text, offset))
    return { text: migrated, unread }
}

function migrate(
    text: string,
    kind: Kind,
    base: number,
    unread: number[],
): string {
    if (!text.includes('reactive')) return text
    if (kind === 'ts') return migrateModule(text, base, unread)
    if (kind === 'md')
        return replaceSpans(
            text,
            /^([ \t]*)(```|~~~)([\w-]*)[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm,
            4,
            (inner) => (inner.includes('<script') ? 'abide' : 'ts'),
            base,
            unread,
        )
    // An `.abide` file: its script blocks are modules, and a code sample written in its markup — a
    // template literal handed to a prop — is a file of its own, shown rather than run.
    const migrated = replaceSpans(
        text,
        /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g,
        2,
        () => 'ts',
        base,
        unread,
    )
    return replaceOutsideScripts(migrated, base, unread)
}

/** Each match's group `group` migrated as the grammar `kindOf` reads it as, the rest kept. */
function replaceSpans(
    text: string,
    pattern: RegExp,
    group: number,
    kindOf: (inner: string) => Kind,
    base: number,
    unread: number[],
): string {
    let out = ''
    let last = 0
    const indexed = new RegExp(pattern.source, `${pattern.flags}d`)
    for (const match of text.matchAll(indexed)) {
        const inner = match[group] ?? ''
        const start = match.indices?.[group]?.[0] ?? match.index ?? 0
        out += text.slice(last, start)
        out += migrate(inner, kindOf(inner), base + start, unread)
        last = start + inner.length
    }
    return out + text.slice(last)
}

/** The template literals an `.abide` file's markup holds, each migrated as the code it shows. */
function replaceOutsideScripts(
    text: string,
    base: number,
    unread: number[],
): string {
    let out = ''
    let last = 0
    for (const script of text.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)) {
        const start = script.index ?? 0
        out += samples(text.slice(last, start), base + last, unread)
        out += script[0]
        last = start + script[0].length
    }
    return out + samples(text.slice(last), base + last, unread)
}

/** `markup` with each backtick-delimited sample in it migrated. */
function samples(markup: string, base: number, unread: number[]): string {
    return replaceSpans(
        markup,
        /`((?:\\[\s\S]|[^`\\])*)`/g,
        1,
        (inner) => (inner.includes('<script') ? 'abide' : 'ts'),
        base,
        unread,
    )
}

/** A module's `reactive` calls over a body renamed, and `memo` imported beside `reactive`. */
function migrateModule(text: string, base: number, unread: number[]): string {
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
        const form = formOf(tokens, open + 1, text)
        if (form === 'body') renames.push(token.start)
        else if (form === 'name') unread.push(base + token.start)
    }
    let migrated = text
    for (let index = renames.length - 1; index >= 0; index -= 1) {
        const start = renames[index] as number
        migrated =
            migrated.slice(0, start) +
            'memo' +
            migrated.slice(start + 'reactive'.length)
    }
    migrated = migrateSamples(migrated, base, unread)
    return withMemoImported(migrated, renames.length > 0)
}

/** The template literals a module holds — a code sample a docs page shows — each migrated. */
function migrateSamples(text: string, base: number, unread: number[]): string {
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
        out += migrate(
            inner,
            inner.includes('<script') ? 'abide' : 'ts',
            base + token.start + 1,
            unread,
        )
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
 * Whether the argument starting at `at` is a body written in place, a bare name — a body only where
 * `text` binds it to one — or anything else.
 */
function formOf(
    tokens: Token[],
    at: number,
    text: string,
): 'body' | 'name' | 'value' {
    const first = tokens[at] as Token | undefined
    if (first === undefined) return 'value'
    if (first.kind === SyntaxKind.FunctionKeyword) return 'body'
    if (first.text === 'async') {
        const next = tokens[at + 1] as Token | undefined
        if (
            next?.kind === SyntaxKind.FunctionKeyword ||
            next?.kind === SyntaxKind.OpenParenToken ||
            (next?.kind === SyntaxKind.Identifier &&
                tokens[at + 2]?.kind === SyntaxKind.EqualsGreaterThanToken)
        )
            return 'body'
    }
    if (first.kind === SyntaxKind.OpenParenToken) {
        const close = matching(tokens, at)
        const next = tokens[close + 1] as Token | undefined
        if (
            next?.kind === SyntaxKind.EqualsGreaterThanToken ||
            next?.kind === SyntaxKind.ColonToken
        )
            return 'body'
        return 'value'
    }
    if (first.kind === SyntaxKind.LessThanToken) return 'body'
    if (first.kind === SyntaxKind.Identifier) {
        const next = tokens[at + 1] as Token | undefined
        if (next?.kind === SyntaxKind.EqualsGreaterThanToken) return 'body'
        if (
            next?.kind === SyntaxKind.CloseParenToken ||
            next?.kind === SyntaxKind.CommaToken
        )
            return bindsFunction(text, first.text, first.start)
                ? 'body'
                : 'name'
        // `feed.body`: a member whose value only the checker knows.
        let end = at + 1
        while (
            tokens[end]?.kind === SyntaxKind.DotToken &&
            tokens[end + 1]?.kind === SyntaxKind.Identifier
        )
            end += 2
        const after = tokens[end] as Token | undefined
        if (
            end > at + 1 &&
            (after?.kind === SyntaxKind.CloseParenToken ||
                after?.kind === SyntaxKind.CommaToken)
        )
            return 'name'
    }
    return 'value'
}

/** The index of the `)` closing the `(` at `at`. */
function matching(tokens: Token[], at: number): number {
    let depth = 0
    for (let index = at; index < tokens.length; index += 1) {
        const kind = (tokens[index] as Token).kind
        if (kind === SyntaxKind.OpenParenToken) depth += 1
        else if (kind === SyntaxKind.CloseParenToken) {
            depth -= 1
            if (depth === 0) return index
        }
    }
    return tokens.length - 1
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
    const close = matching(tokens, 0)
    const after = tokens[close + 1]
    return (
        after?.kind === SyntaxKind.EqualsGreaterThanToken ||
        after?.kind === SyntaxKind.ColonToken
    )
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

function lineAt(text: string, offset: number): number {
    let line = 1
    for (let index = 0; index < offset && index < text.length; index += 1)
        if (text.charCodeAt(index) === 10) line += 1
    return line
}
