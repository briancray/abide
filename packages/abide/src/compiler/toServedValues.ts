// 38.230 — A HANDLER SERVES NO `Reactive` (16.109), and one declared over a name the app declares as
// a `reactive` or a `reactive.derived` now throws where it is declared. Which `memo` it should serve is
// the app's to decide — the value's readers await it where a memo is called — so each is a note
// (38.226), found across files: the handler is rarely where the value is declared.

import { posix } from 'node:path' // Bun has no path joiner of its own; `posix` keeps `/` on every host.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isAbideSpecifier } from './hookCalls.ts'
import { lineAround } from './rewriteCode.ts'
import { importStatements } from './splitImports.ts'
import { type Token, tokenize } from './tokenize.ts'

type Note = (path: string, line: string, message: string) => void

const HANDLERS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

const SERVES_A_VALUE = (name: string): string =>
    `a handler serves no Reactive, and ${name} is a reactive, so this throws where it is declared: make ${name} a memo — memo(fn, options) — and serve that; whatever awaited ${name} then calls ${name}(). RULEBOOK 16.109, 38.230.`

/**
 * 38.230 — every handler the app declares over a value it declares as a `reactive` or a
 * `reactive.derived`, noted; nothing is rewritten. `read` and `sources` as a migration is handed them.
 */
export async function toServedValues(
    read: (path: string) => Promise<string | undefined>,
    sources: () => Promise<string[]>,
    note: Note,
): Promise<Record<string, string>> {
    const aliases = importAliases(await read('package.json'))
    for (const path of await sources()) {
        if (!/\.(ts|tsx|abide)$/.test(path)) continue
        const text = await read(path)
        if (text === undefined) continue
        const handlers = new Set<string>()
        const imported = new Map<string, { from: string; name: string }>()
        for (const statement of importStatements(text))
            for (const binding of statement.bindings) {
                if (binding.typeOnly) continue
                if (isAbideSpecifier(statement.specifier)) {
                    if (HANDLERS.has(binding.imported))
                        handlers.add(binding.local)
                } else
                    imported.set(binding.local, {
                        from: statement.specifier,
                        name: binding.imported,
                    })
            }
        if (handlers.size === 0) continue
        const tokens = tokenize(text)
        for (let at = 0; at < tokens.length; at += 1) {
            const token = tokens[at] as Token
            if (
                token.kind !== SyntaxKind.Identifier ||
                !handlers.has(token.text) ||
                tokens[at - 1]?.kind === SyntaxKind.DotToken ||
                tokens[at + 1]?.kind !== SyntaxKind.OpenParenToken
            )
                continue
            const served = tokens[at + 2]
            const after = tokens[at + 3]?.kind
            if (
                served?.kind !== SyntaxKind.Identifier ||
                (after !== SyntaxKind.CloseParenToken &&
                    after !== SyntaxKind.CommaToken)
            )
                continue
            let declaredIn = text
            let declaredAs = served.text
            const source = imported.get(served.text)
            if (source !== undefined) {
                const target = resolve(path, source.from, aliases)
                const found =
                    target === undefined ? undefined : await read(target)
                if (found === undefined) continue
                declaredIn = found
                declaredAs = source.name
            }
            if (!declaresValue(declaredIn, declaredAs)) continue
            note(
                path,
                lineAround(text, token.start),
                SERVES_A_VALUE(served.text),
            )
        }
    }
    return {}
}

/** Whether `text` declares `name` as a `reactive` or a `reactive.derived`, its default export included. */
function declaresValue(text: string, name: string): boolean {
    const value = String.raw`reactive(?:\s*\.\s*derived)?\s*[<(]`
    if (name === 'default')
        return new RegExp(String.raw`export\s+default\s+${value}`).test(text)
    return new RegExp(
        String.raw`(?:const|let|var)\s+${name}\s*(?::[^=]+)?=\s*${value}`,
    ).test(text)
}

/** The package's `imports` map, each `#prefix/*` to the directory it stands for. */
function importAliases(manifest: string | undefined): Map<string, string> {
    const aliases = new Map<string, string>()
    if (manifest === undefined) return aliases
    let imports: unknown
    try {
        imports = (JSON.parse(manifest) as { imports?: unknown }).imports
    } catch {
        return aliases
    }
    if (typeof imports !== 'object' || imports === null) return aliases
    for (const [key, target] of Object.entries(imports))
        if (
            key.endsWith('/*') &&
            typeof target === 'string' &&
            target.endsWith('/*')
        )
            aliases.set(key.slice(0, -1), posix.normalize(target.slice(0, -1)))
    return aliases
}

/** The app path `specifier` names from `path`, or `undefined` where it is a package's. */
function resolve(
    path: string,
    specifier: string,
    aliases: Map<string, string>,
): string | undefined {
    if (specifier.startsWith('.'))
        return posix.join(posix.dirname(path), specifier)
    for (const [prefix, directory] of aliases)
        if (specifier.startsWith(prefix))
            return posix.join(directory, specifier.slice(prefix.length))
    return undefined
}
