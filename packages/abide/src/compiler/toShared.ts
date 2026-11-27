// 38.229 — THE MIGRATION TO `reactive.shared`: a value shared down the component tree is a HANDLE
// declared once and called where the value is wanted, rather than a string key every caller repeats.
// A key one file uses alone becomes a handle declared at that file's module level — a `<script
// module>` in an `.abide` file — and every call of it `handle()`. A key several files use is one
// handle they should all import, which is the app's to place, so each of those calls is a note
// (38.226), as is a key that is no literal.

import { SyntaxKind } from 'typescript/unstable/ast'

import { SHARED_SPECIFIER } from '#shared/SPECIFIERS.ts'

import { isAbideSpecifier } from './hookCalls.ts'
import {
    lineAround,
    SCRIPT,
    type Splice,
    spliced,
    splicedOffset,
} from './rewriteCode.ts'
import {
    type ImportStatement,
    importStatements,
    namedImports,
} from './splitImports.ts'
import { argumentCommas, closerOf, type Token, tokenize } from './tokenize.ts'

type Note = (path: string, line: string, message: string) => void

/** One `reactive.share(…)` call: where it stands in its file, its key, and its `create`. */
type Call = {
    start: number
    end: number
    key: string | undefined
    create: string
}

const ACROSS =
    'reactive.share is reactive.shared(create), a handle declared once: this key is shared across files, so export one handle from a module they all import — export const handle = reactive.shared(create) — and call it here as handle(). RULEBOOK 10.4, 38.229.'
const NOT_LITERAL =
    'reactive.share is reactive.shared(create), a handle declared once and called as handle(): a key that is no literal names no one handle, so declare one per value. RULEBOOK 10.4, 38.229.'
const OTHER_CREATE =
    "reactive.shared's create is the handle's, and this call's differed from the first: the value now opens as the handle's create makes it, so write this one's opening value where it is wanted. RULEBOOK 10.6, 38.229."

/**
 * 38.229 — every source the app holds with its `reactive.share` calls moved to handles, as the files
 * it changed; `read` and `sources` as a migration is handed them.
 */
export async function toShared(
    read: (path: string) => Promise<string | undefined>,
    sources: () => Promise<string[]>,
    note: Note,
): Promise<Record<string, string>> {
    const found = new Map<string, { text: string; calls: Call[] }>()
    const filesOf = new Map<string, Set<string>>()
    for (const path of await sources()) {
        if (!/\.(ts|tsx|abide)$/.test(path)) continue
        const text = await read(path)
        if (text === undefined || !text.includes('reactive.share(')) continue
        const calls = callsIn(text)
        if (calls.length === 0) continue
        found.set(path, { text, calls })
        for (const call of calls)
            if (call.key !== undefined)
                filesOf.set(
                    call.key,
                    (filesOf.get(call.key) ?? new Set()).add(path),
                )
    }
    const changed: Record<string, string> = {}
    for (const [path, { text, calls }] of found) {
        const handles = new Map<string, { name: string; create: string }>()
        const edits: Splice[] = []
        const noted: { at: number; message: string }[] = []
        for (const call of calls) {
            if (call.key === undefined) {
                noted.push({ at: call.start, message: NOT_LITERAL })
                continue
            }
            if ((filesOf.get(call.key)?.size ?? 0) > 1) {
                noted.push({ at: call.start, message: ACROSS })
                continue
            }
            let handle = handles.get(call.key)
            if (handle === undefined) {
                handle = { name: nameFor(call.key, text), create: call.create }
                handles.set(call.key, handle)
            } else if (handle.create !== call.create)
                noted.push({ at: call.start, message: OTHER_CREATE })
            edits.push({
                start: call.start,
                end: call.end,
                text: `${handle.name}()`,
            })
        }
        let out = spliced(text, edits)
        // The noted lines are read off the calls as edited, ahead of the declarations moving them.
        for (const { at, message } of noted)
            note(path, lineAround(out, splicedOffset(at, edits)), message)
        if (handles.size > 0) out = declared(out, path, [...handles.values()])
        if (out !== text) changed[path] = out
    }
    return changed
}

/** Every `reactive.share(key, create)` call in `text`, each at its offset in `text`. */
function callsIn(text: string): Call[] {
    const calls: Call[] = []
    const tokens = tokenize(text)
    for (let at = 0; at + 3 < tokens.length; at += 1) {
        if ((tokens[at] as Token).text !== 'reactive') continue
        if (tokens[at - 1]?.kind === SyntaxKind.DotToken) continue
        if ((tokens[at + 1] as Token).kind !== SyntaxKind.DotToken) continue
        if ((tokens[at + 2] as Token).text !== 'share') continue
        const open = at + 3
        if ((tokens[open] as Token).kind !== SyntaxKind.OpenParenToken) continue
        const close = closerOf(tokens, open)
        const comma = argumentCommas(tokens, open)[0]
        if (close === -1 || comma === undefined) continue
        const key = tokens[open + 1] as Token
        const literal =
            key.kind === SyntaxKind.StringLiteral &&
            (tokens[open + 2] as Token).kind === SyntaxKind.CommaToken
        calls.push({
            start: (tokens[at] as Token).start,
            end: (tokens[close] as Token).end,
            key: literal ? key.text.slice(1, -1) : undefined,
            create: text
                .slice(
                    (tokens[comma] as Token).end,
                    (tokens[close] as Token).start,
                )
                .trim()
                .replace(/,$/, ''),
        })
    }
    return calls
}

/** An identifier for `key`, kept apart from every name `text` already spells. */
function nameFor(key: string, text: string): string {
    const words = key.split(/[^A-Za-z0-9_$]+/).filter(Boolean)
    let name = words
        .map((word, index) =>
            index === 0 ? word : word[0]?.toUpperCase() + word.slice(1),
        )
        .join('')
    if (!/^[A-Za-z_$]/.test(name)) name = `shared${name}`
    for (const token of tokenize(text))
        if (token.kind === SyntaxKind.Identifier && token.text === name)
            return `${name}Shared`
    return name
}

/**
 * `text` with each handle declared at module level: after a module's imports, or in an `.abide`
 * file's `<script module>`, opened where it has none, with abide's `reactive` imported there.
 */
function declared(
    text: string,
    path: string,
    handles: { name: string; create: string }[],
): string {
    const lines = handles
        .map(({ name, create }) => `const ${name} = reactive.shared(${create})`)
        .join('\n')
    if (!path.endsWith('.abide')) return afterImports(text, lines)
    const scripts = [...text.matchAll(new RegExp(SCRIPT.source, 'gdi'))]
    const module = scripts.find((match) => /\bmodule\b/.test(match[1] ?? ''))
    if (module !== undefined) {
        // Edited from the end, so each range is where the scan found it.
        let out = text
        const ranges = scripts
            .map((match): [number, number] => match.indices?.[2] ?? [0, 0])
            .sort((a, b) => b[0] - a[0])
        const [moduleOpen] = module.indices?.[2] ?? [0, 0]
        for (const [open, close] of ranges) {
            const body = out.slice(open, close)
            const moved =
                open === moduleOpen
                    ? afterImports(withReactive(body), lines)
                    : withoutReactive(body)
            out = `${out.slice(0, open)}${moved}${out.slice(close)}`
        }
        return out
    }
    // A `<script module>` of its own, which takes `reactive` from the instance's script: the two
    // are one scope (34.2), and one name imported twice in it is an error.
    let out = text
    const instance = scripts[0]
    if (instance !== undefined) {
        const [open, close] = instance.indices?.[2] ?? [0, 0]
        out = `${out.slice(0, open)}${withoutReactive(out.slice(open, close))}${out.slice(close)}`
    }
    const opening = scripts[0]?.index ?? 0
    return `${out.slice(0, opening)}<script module>\nimport { reactive } from '${SHARED_SPECIFIER}'\n\n${lines}\n</script>\n\n${out.slice(opening)}`
}

/** `code` with `lines` after its last import, or at its top where it has none. */
function afterImports(code: string, lines: string): string {
    const statements = importStatements(code)
    const last = statements[statements.length - 1]
    if (last === undefined) return `\n${lines}\n${code}`
    return `${code.slice(0, last.end)}\n\n${lines}${code.slice(last.end)}`
}

/** The import of abide's names in braces `code` makes, or `undefined`. */
function abideImport(code: string): ImportStatement | undefined {
    for (const statement of importStatements(code))
        if (
            !statement.typeOnly &&
            isAbideSpecifier(statement.specifier) &&
            statement.bindings.every(
                (binding) =>
                    binding.imported !== 'default' && binding.imported !== '*',
            )
        )
            return statement
    return undefined
}

/** `code` importing abide's `reactive`, beside its other abide names where it imports some. */
function withReactive(code: string): string {
    const statement = abideImport(code)
    if (statement === undefined)
        return `\nimport { reactive } from '${SHARED_SPECIFIER}'\n${code}`
    if (statement.bindings.some((binding) => binding.imported === 'reactive'))
        return code
    const names = statement.bindings.map((binding) => binding.written)
    names.push('reactive')
    const list = namedImports(code, statement, names)
    return `${code.slice(0, list.start)}${list.text}${code.slice(list.end)}`
}

/** `code` without its import of abide's `reactive`, the statement dropped where nothing is left. */
function withoutReactive(code: string): string {
    const statement = abideImport(code)
    if (statement === undefined) return code
    const kept = statement.bindings
        .filter((binding) => binding.imported !== 'reactive')
        .map((binding) => binding.written)
    if (kept.length === statement.bindings.length) return code
    if (kept.length === 0) {
        const end =
            code[statement.end] === '\n' ? statement.end + 1 : statement.end
        // And the blank line that set it apart from what follows.
        const after = code[end] === '\n' ? end + 1 : end
        return `${code.slice(0, statement.start)}${code.slice(after)}`
    }
    const list = namedImports(code, statement, kept)
    return `${code.slice(0, list.start)}${list.text}${code.slice(list.end)}`
}
