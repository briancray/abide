// 38.231 — THE MIGRATION TO `rpc`: `GET`, `POST`, `PUT`, `PATCH` and `DELETE` are one `rpc`, its verb
// read off the value — a function's `GET` — or named by `methods`. So `GET(x, o)` is `rpc(x, o)`, and a
// mutation keeps its verb in its options: `POST(f, o)` is `rpc(f, { methods: ['POST'], ...o })`. A
// handler file is a server file (16.73): `<name>.handler.ts` is `<name>.server.ts`, answering at the
// same route, and every import naming it is moved with it. A handler a `<script server>` declares is
// a value it exports bare (16.70): `rpc(v)` there is `v`, and one given options is noted, as only a
// server file's `rpc` takes them.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isAbideSpecifier } from './hookCalls.ts'
import { rewriteCode } from './rewriteCode.ts'
import { importStatements, namedImports } from './splitImports.ts'
import {
    argumentCommas,
    closerOf,
    nesting,
    type Token,
    tokenize,
} from './tokenize.ts'

type Note = (path: string, line: string, message: string) => void

const VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

const TAKEN =
    'abide upgrade moves a handler file to <name>.server.ts, and that file is already there: merge the two — the handler as `export default rpc(…)` — so it answers where it did. RULEBOOK 16.73, 38.231.'

const SCRIPT = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g

const OPTIONED =
    "a <script server> exports bare values, and `rpc` with options is a server file's: move this one to a <name>.server.ts beside the component, and import it where it is called. RULEBOOK 16.70, 38.231."

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
        const migrated = toRpcText(text, path, isSpecifier, (line, message) =>
            note(moved.get(path) ?? path, line, message),
        )
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
    note: (line: string, message: string) => void = () => {},
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
            ? `${open}${bareExports(exportedHandlers(body), isSpecifier, note)}${close}`
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

/**
 * 16.70 — a server block with each top-level `export const x = rpc(v)` exported as `v`, and abide's
 * `rpc` no longer imported where nothing else names it. One given options is left, and noted.
 */
function bareExports(
    body: string,
    isSpecifier: (specifier: string) => boolean,
    note: (line: string, message: string) => void,
): string {
    if (!body.includes('rpc(')) return body
    const tokens = tokenize(body)
    const edits: Edit[] = []
    let depth = 0
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] as Token
        const moved = nesting(token.kind)
        if (moved !== 0) {
            depth += moved
            continue
        }
        if (
            depth !== 0 ||
            token.text !== 'export' ||
            !(
                tokens[index + 1]?.text === 'const' ||
                tokens[index + 1]?.text === 'let'
            ) ||
            tokens[index + 2]?.kind !== SyntaxKind.Identifier ||
            tokens[index + 3]?.kind !== SyntaxKind.EqualsToken ||
            tokens[index + 4]?.text !== 'rpc' ||
            tokens[index + 5]?.kind !== SyntaxKind.OpenParenToken
        )
            continue
        const open = index + 5
        const close = closerOf(tokens, open)
        if (close === -1) continue
        const commas = argumentCommas(tokens, open)
        // A comma before the closer alone is a trailing one: the value is the only argument.
        const optioned =
            commas.length > 1 ||
            (commas.length === 1 && commas[0] !== close - 1)
        if (optioned) {
            const lineStart = body.lastIndexOf('\n', token.start) + 1
            const lineEnd = body.indexOf('\n', token.start)
            note(
                body.slice(lineStart, lineEnd === -1 ? undefined : lineEnd),
                OPTIONED,
            )
            continue
        }
        const first = tokens[open + 1] as Token
        const last = tokens[
            commas.length === 1 ? close - 2 : close - 1
        ] as Token
        edits.push({
            start: (tokens[index + 4] as Token).start,
            end: (tokens[close] as Token).end,
            text: body.slice(first.start, last.end),
        })
    }
    if (edits.length === 0) return body
    let out = body
    for (let index = edits.length - 1; index >= 0; index -= 1) {
        const edit = edits[index] as Edit
        out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`
    }
    return withoutUnusedRpc(out, isSpecifier)
}

/** `body` without abide's `rpc` in its imports, where no other token of it names `rpc`. */
function withoutUnusedRpc(
    body: string,
    isSpecifier: (specifier: string) => boolean,
): string {
    const statements = importStatements(body)
    let named = 0
    for (const token of tokenize(body))
        if (token.kind === SyntaxKind.Identifier && token.text === 'rpc')
            named += 1
    for (let index = statements.length - 1; index >= 0; index -= 1) {
        const statement = statements[index] as (typeof statements)[number]
        if (!isSpecifier(statement.specifier)) continue
        const binding = statement.bindings.find(
            (each) => each.imported === 'rpc' && each.local === 'rpc',
        )
        // Named by the import alone: nothing in the block calls it any more.
        if (binding === undefined || named > 1) continue
        const kept: string[] = []
        for (const each of statement.bindings)
            if (each !== binding) kept.push(each.written)
        if (kept.length === 0) {
            // The statement, its line break, and the blank line that set it apart from the code.
            let end = statement.end
            if (body[end] === '\n') end += 1
            if (body[end] === '\n') end += 1
            return `${body.slice(0, statement.start)}${body.slice(end)}`
        }
        const edit = namedImports(body, statement, kept)
        return `${body.slice(0, edit.start)}${edit.text}${body.slice(edit.end)}`
    }
    return body
}
