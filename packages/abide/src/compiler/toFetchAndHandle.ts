// 38.225 — THE MIGRATION TO `fetchAndHandle`: `fetchData` is renamed where a file imports it from
// abide, at the import and at every use — a member access (`x.fetchData`) and a name an app declared
// itself are left. A scan, as `toMemo` is.
//
// `fetchData` RESOLVED to its `FetchFailed` and `fetchAndHandle` REJECTS with it (54.13), so a rename
// alone leaves an `isFailed` check on the answer that never fires. Where the answer is a name a file
// then hands `isFailed`, the call catches its own failure back into the answer, which is the old
// behaviour spelled out; every other call in a file that checks a failure, and every `ttl` the call no
// longer takes, is a note (38.226) — what it should do instead is the app's to decide.

import { SyntaxKind } from 'typescript/unstable/ast'

import { abideBindings, localOf } from './hookCalls.ts'
import {
    lineAround,
    rewriteCode,
    type Splice,
    spliced,
    splicedOffset,
} from './rewriteCode.ts'
import {
    afterTypeArguments,
    closerOf,
    type Token,
    tokenize,
} from './tokenize.ts'

/** A line a migration changed what it does and could not rewrite, and what to do about it. */
export type Note = (line: string, message: string) => void

const CAUGHT = `.catch((failed) => fetchAndHandle.isError(failed, 'FetchFailed') ? failed : Promise.reject(failed))`

const REJECTS =
    'fetchAndHandle rejects with its FetchFailed where fetchData answered it: an isFailed check on this answer never fires. Catch it, and narrow with fetchAndHandle.isError. RULEBOOK 54.13.'
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

function renamed(code: string, note: Note): string {
    if (localOf(abideBindings([code]), 'fetchData') === undefined) return code
    const checks = code.includes('isFailed(')
    const edits: Splice[] = []
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
        const open = afterTypeArguments(tokens, at + 1)
        const close =
            tokens[open]?.kind === SyntaxKind.OpenParenToken
                ? closerOf(tokens, open)
                : -1
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
    const out = spliced(code, edits)
    // Where each noted call stands once every edit ahead of it has moved it.
    for (const { at, message } of noted)
        note(lineAround(out, splicedOffset(at, edits)), message)
    return out
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
