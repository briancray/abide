// 38.225 — THE MIGRATION TO `fetchAndHandle`: `fetchData` is renamed where a file imports it from
// abide, at the import and at every use — a member access (`x.fetchData`) and a name an app declared
// itself are left. A scan, as `toMemo` is.
//
// `fetchData` RESOLVED to its `FetchFailed` and `fetchAndHandle` REJECTS with it (54.16), so a rename
// alone leaves an `isFailed` check on the answer that never fires. Where the answer is a name a file
// then hands `isFailed`, the call catches its own failure back into the answer, which is the old
// behaviour spelled out; every other call in a file that checks a failure, and every `ttl` the call no
// longer takes, is a note (38.226) — what it should do instead is the app's to decide.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isAbideSpecifier } from './hookCalls.ts'
import { rewriteCode } from './rewriteCode.ts'
import { importStatements } from './splitImports.ts'
import { type Token, tokenize } from './tokenize.ts'

/** A line a migration changed what it does and could not rewrite, and what to do about it. */
export type Note = (line: string, message: string) => void

const CAUGHT = `.catch((failed) => fetchAndHandle.isError(failed, 'FetchFailed') ? failed : Promise.reject(failed))`

const REJECTS =
    'fetchAndHandle rejects with its FetchFailed where fetchData answered it: an isFailed check on this answer never fires. Catch it, and narrow with fetchAndHandle.isError. RULEBOOK 54.16.'
const NO_TTL =
    'fetchAndHandle keeps no answer, so ttl does nothing: hold the answer in a memo with a ttl. RULEBOOK 38.225.'

/** 38.225 — `text`, a file at `path`, with abide's `fetchData` renamed `fetchAndHandle`. */
export function toFetchAndHandle(
    text: string,
    path: string,
    note: Note = () => {},
): string {
    return rewriteCode(text, path, {
        word: 'fetchData',
        module: (code) => renamed(code, note),
    })
}

type Edit = { start: number; end: number; text: string }

function renamed(code: string, note: Note): string {
    let imported = false
    for (const statement of importStatements(code))
        if (isAbideSpecifier(statement.specifier))
            for (const binding of statement.bindings)
                if (binding.imported === 'fetchData') imported = true
    if (!imported) return code
    const checks = code.includes('isFailed(')
    const edits: Edit[] = []
    const noted: { at: number; message: string }[] = []
    const tokens = tokenize(code)
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind !== SyntaxKind.Identifier || token.text !== 'fetchData')
            continue
        if (tokens[at - 1]?.kind === SyntaxKind.DotToken) continue
        edits.push({
            start: token.start,
            end: token.start + 'fetchData'.length,
            text: 'fetchAndHandle',
        })
        const open = pastTypeArguments(tokens, at + 1)
        const close = closingParen(tokens, open)
        // The import, or the name handed on uncalled: nothing is answered here.
        if (close === -1) continue
        if (takesTtl(tokens, open + 1, close))
            noted.push({ at: token.start, message: NO_TTL })
        const answer = answerName(tokens, at)
        if (
            answer !== undefined &&
            new RegExp(`\\bisFailed\\(\\s*${answer}\\s*\\)`).test(code)
        )
            edits.push({
                start: (tokens[close] as Token).end,
                end: (tokens[close] as Token).end,
                text: CAUGHT,
            })
        else if (checks) noted.push({ at: token.start, message: REJECTS })
    }
    edits.sort((left, right) => left.start - right.start)
    let out = code
    for (let index = edits.length - 1; index >= 0; index -= 1) {
        const edit = edits[index] as Edit
        out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`
    }
    // Where each noted call stands once every edit ahead of it has moved it.
    for (const { at, message } of noted) {
        let moved = at
        for (const edit of edits)
            if (edit.end <= at)
                moved += edit.text.length - (edit.end - edit.start)
        const lineStart = out.lastIndexOf('\n', moved - 1) + 1
        const lineEnd = out.indexOf('\n', moved)
        note(
            out.slice(lineStart, lineEnd === -1 ? undefined : lineEnd),
            message,
        )
    }
    return out
}

/** The index of the `)` closing the call whose `(` is at `open`, or -1 where `open` opens none. */
function closingParen(tokens: Token[], open: number): number {
    if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) return -1
    let depth = 0
    for (let at = open; at < tokens.length; at += 1) {
        const kind = (tokens[at] as Token).kind
        if (kind === SyntaxKind.OpenParenToken) depth += 1
        else if (kind === SyntaxKind.CloseParenToken) {
            depth -= 1
            if (depth === 0) return at
        }
    }
    return -1
}

/** The index past `fetchData<T>`'s type arguments where `at` opens them, or `at`. */
function pastTypeArguments(tokens: Token[], at: number): number {
    if (tokens[at]?.kind !== SyntaxKind.LessThanToken) return at
    let depth = 0
    for (let index = at; index < tokens.length; index += 1) {
        const kind = (tokens[index] as Token).kind
        if (kind === SyntaxKind.LessThanToken) depth += 1
        else if (kind === SyntaxKind.GreaterThanToken) {
            depth -= 1
            if (depth === 0) return index + 1
        }
    }
    return at
}

/** Whether the arguments between `from` and `to` name a `ttl` member. */
function takesTtl(tokens: Token[], from: number, to: number): boolean {
    for (let at = from; at < to; at += 1) {
        const token = tokens[at] as Token
        if (token.kind === SyntaxKind.Identifier && token.text === 'ttl')
            return true
    }
    return false
}

/** `answer` where the call at `at` is `const answer = await fetchData(…)`, or `let` / `var`. */
function answerName(tokens: Token[], at: number): string | undefined {
    const awaited = tokens[at - 1]
    const equals = tokens[at - 2]
    const name = tokens[at - 3]
    const declared = tokens[at - 4]
    if (
        awaited?.kind !== SyntaxKind.AwaitKeyword ||
        equals?.kind !== SyntaxKind.EqualsToken ||
        name?.kind !== SyntaxKind.Identifier ||
        (declared?.kind !== SyntaxKind.ConstKeyword &&
            declared?.kind !== SyntaxKind.LetKeyword &&
            declared?.kind !== SyntaxKind.VarKeyword)
    )
        return undefined
    return name.text
}
