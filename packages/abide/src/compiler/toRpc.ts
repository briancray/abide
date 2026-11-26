// 38.231 — THE MIGRATION TO `rpc`: `GET`, `POST`, `PUT`, `PATCH` and `DELETE` are one `rpc`, its verb
// read off the value — a function's `GET` — or named by `methods`. So `GET(x, o)` is `rpc(x, o)`, and a
// mutation keeps its verb in its options: `POST(f, o)` is `rpc(f, { methods: ['POST'], ...o })`. A
// handler file is a server file (16.73): `<name>.handler.ts` is `<name>.server.ts`, answering at the
// same route, and every import naming it is moved with it. A handler a `<script server>` declares is
// a value it exports (16.70), so its binding is exported.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isAbideSpecifier } from './hookCalls.ts'
import { rewriteCode } from './rewriteCode.ts'
import { importStatements, namedImports } from './splitImports.ts'
import { argumentCommas, closerOf, type Token, tokenize } from './tokenize.ts'

type Note = (path: string, line: string, message: string) => void

const VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

const TAKEN =
    'abide upgrade moves a handler file to <name>.server.ts, and that file is already there: merge the two — the handler as `export default rpc(…)` — so it answers where it did. RULEBOOK 16.73, 38.231.'

const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g

/**
 * 38.231 — every source the app holds with its handlers declared by `rpc`, and each handler file
 * moved to a server file: the text of each file it changes by path, `null` for a file it moves
 * away from. `isSpecifier` says which import specifiers are abide's.
 */
export async function toRpc(
    read: (path: string) => Promise<string | undefined>,
    sources: () => Promise<string[]>,
    note: Note,
    move: (from: string, to: string) => void = () => {},
    isSpecifier: (specifier: string) => boolean = isAbideSpecifier,
): Promise<Record<string, string | null>> {
    const changed: Record<string, string | null> = {}
    const paths = await sources()
    const present = new Set(paths)
    const moved = new Map<string, string>()
    const taken = new Set<string>()
    for (const path of paths) {
        if (!path.endsWith('.handler.ts')) continue
        const target = `${path.slice(0, -'.handler.ts'.length)}.server.ts`
        if (present.has(target)) taken.add(path)
        else moved.set(path, target)
    }
    for (const path of paths) {
        const text = await read(path)
        if (text === undefined) continue
        const migrated = toRpcText(text, path, isSpecifier)
        if (taken.has(path)) note(path, migrated.split('\n')[0] ?? '', TAKEN)
        const target = moved.get(path)
        if (target !== undefined) {
            changed[target] = migrated
            changed[path] = null
            move(path, target)
        } else if (migrated !== text) changed[path] = migrated
    }
    return changed
}

/** `text`, a file at `path`, with its handlers declared by `rpc` and its handler files named anew. */
export function toRpcText(
    text: string,
    path: string,
    isSpecifier: (specifier: string) => boolean = isAbideSpecifier,
): string {
    let out = movedSpecifiers(text)
    // The rewrite reads a file holding a verb's name: a file importing one of them holds it.
    for (const verb of VERBS)
        if (out.includes(verb))
            out = rewriteCode(out, path, {
                word: verb,
                module: (code) => declaredByRpc(code, isSpecifier),
            })
    if (!path.endsWith('.abide')) return out
    // 16.70 — a server block's handler is a value it exports.
    return out.replace(SCRIPT, (whole, open: string, body: string, close) =>
        /\bserver\b/.test(open)
            ? `${open}${exportedHandlers(body)}${close}`
            : whole,
    )
}

/** Each import specifier naming a handler file, `.handler` or `.handler.ts`, named for its server file. */
function movedSpecifiers(text: string): string {
    if (!text.includes('.handler')) return text
    return text.replace(
        /(['"`])([^'"`\n]*?)\.handler(\.ts)?\1/g,
        (_whole, quote: string, stem: string, extension = '') =>
            `${quote}${stem}.server${extension}${quote}`,
    )
}

type Edit = { start: number; end: number; text: string }

/** A module with each call of abide's five verbs an `rpc`, and its import moved to `rpc`. */
function declaredByRpc(
    code: string,
    isSpecifier: (specifier: string) => boolean,
): string {
    const verbs = new Map<string, string>()
    const edits: Edit[] = []
    for (const statement of importStatements(code)) {
        if (!isSpecifier(statement.specifier)) continue
        const kept: string[] = []
        let imported = false
        for (const binding of statement.bindings) {
            if (VERBS.has(binding.imported) && !binding.typeOnly) {
                verbs.set(binding.local, binding.imported)
                imported = true
                continue
            }
            if (binding.imported !== 'default' && binding.imported !== '*')
                kept.push(binding.written)
        }
        if (!imported) continue
        if (!kept.includes('rpc')) kept.push('rpc')
        edits.push(namedImports(code, statement, kept))
    }
    if (verbs.size === 0) return code
    const tokens = tokenize(code)
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        const verb =
            token.kind === SyntaxKind.Identifier
                ? verbs.get(token.text)
                : undefined
        if (verb === undefined) continue
        if (tokens[at - 1]?.kind === SyntaxKind.DotToken) continue
        // An import's own binding is rewritten with its statement.
        if (
            edits.some(
                (edit) => token.start >= edit.start && token.end <= edit.end,
            )
        )
            continue
        edits.push({ start: token.start, end: token.end, text: 'rpc' })
        if (verb === 'GET') continue
        const open = at + 1
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        const close = closerOf(tokens, open)
        if (close === -1) continue
        edits.push(methodsOption(code, tokens, open, close, verb))
    }
    edits.sort((left, right) => left.start - right.start)
    let out = code
    for (let index = edits.length - 1; index >= 0; index -= 1) {
        const edit = edits[index] as Edit
        out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`
    }
    return out
}

/** The edit giving the call between `open` and `close` its verb: `methods` in its options. */
function methodsOption(
    code: string,
    tokens: readonly Token[],
    open: number,
    close: number,
    verb: string,
): Edit {
    const methods = `methods: [${JSON.stringify(verb).replaceAll('"', "'")}]`
    const commas = argumentCommas(tokens, open)
    const second = commas[0] === undefined ? undefined : commas[0] + 1
    // No options, or a trailing comma after the handler: the options are the verb alone.
    if (second === undefined || second === close) {
        const at = (tokens[close] as Token).start
        return {
            start: at,
            end: at,
            text:
                second === undefined ? `, { ${methods} }` : ` { ${methods} },`,
        }
    }
    const first = tokens[second] as Token
    if (first.kind === SyntaxKind.OpenBraceToken)
        return { start: first.end, end: first.end, text: ` ${methods},` }
    // Options built elsewhere are spread under the verb.
    const last = commas[1] === undefined ? close - 1 : commas[1] - 1
    return {
        start: first.start,
        end: (tokens[last] as Token).end,
        text: `{ ${methods}, ...${code.slice(first.start, (tokens[last] as Token).end)} }`,
    }
}

/** A server block with each top-level `const x = rpc(` exported. */
function exportedHandlers(body: string): string {
    if (!body.includes('rpc(')) return body
    const tokens = tokenize(body)
    const at: number[] = []
    let depth = 0
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] as Token
        if (
            token.kind === SyntaxKind.OpenBraceToken ||
            token.kind === SyntaxKind.OpenParenToken ||
            token.kind === SyntaxKind.OpenBracketToken
        )
            depth += 1
        else if (
            token.kind === SyntaxKind.CloseBraceToken ||
            token.kind === SyntaxKind.CloseParenToken ||
            token.kind === SyntaxKind.CloseBracketToken
        )
            depth -= 1
        if (depth !== 0) continue
        if (
            (token.text === 'const' || token.text === 'let') &&
            tokens[index - 1]?.text !== 'export' &&
            tokens[index + 1]?.kind === SyntaxKind.Identifier &&
            tokens[index + 2]?.kind === SyntaxKind.EqualsToken &&
            tokens[index + 3]?.text === 'rpc' &&
            tokens[index + 4]?.kind === SyntaxKind.OpenParenToken
        )
            at.push(token.start)
    }
    let out = body
    for (let index = at.length - 1; index >= 0; index -= 1) {
        const start = at[index] as number
        out = `${out.slice(0, start)}export ${out.slice(start)}`
    }
    return out
}
