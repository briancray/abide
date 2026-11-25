// 38.217 — THE MIGRATION OFF `by`: what tells one element from another is named `key` from the
// release this migration is keyed to on, in a `{#for}` head (32.13) and in the options a `reactive`
// or a `memo` is handed (5.22).
//
// A SCAN, NOT A PARSE, as `toMemo` is. A head's `by` is the one `forSeparators` divides it on, so a
// `by` that is the subject's own — `of row.by`, `of by` — is left. An option's `by` is a property
// of the object literal written in place as the call's second argument; options built anywhere
// else are values only the checker can follow, and are left for it to name.

import { SyntaxKind } from 'typescript/unstable/ast'

import { forSeparators } from './parseAbide.ts'
import { type CodeRewrite, rewriteCode } from './rewriteCode.ts'
import {
    afterTypeArguments,
    closerOf,
    nesting,
    slotEnd,
    type Token,
    tokenize,
} from './tokenize.ts'

/** 38.217 — `text`, a file at `path`, with each `by` naming a key renamed `key`. */
export function toKey(text: string, path: string): string {
    if (!text.includes('by')) return text
    return forHeadsKeyed(rewriteCode(text, path, TO_KEY))
}

const TO_KEY: CodeRewrite = {
    word: 'by',
    module: optionsKeyed,
    scripts: (blocks) => blocks.map(optionsKeyed),
}

const FOR_HEAD = /\{\s*#for\b/g

/** Each `{#for}` head in `text` dividing its key with `by`, divided with `key`. */
function forHeadsKeyed(text: string): string {
    let out = ''
    let last = 0
    for (const found of text.matchAll(FOR_HEAD)) {
        const open = found.index
        if (open < last) continue
        const headerAt = open + found[0].length
        const close = slotEnd(text, open)
        const header = text.slice(headerAt, close)
        // A head already keyed is past the migration, and a `by` in its key is a name (38.200).
        if (forSeparators(header).key !== undefined) continue
        const divider = forSeparators(header, 'by').key
        if (divider === undefined) continue
        out += text.slice(last, headerAt + divider.start) + 'key'
        last = headerAt + divider.end
    }
    return out + text.slice(last)
}

const KEYED_CALLS = new Set(['reactive', 'memo'])

/** A module with the `by` of each options object written in place for `reactive` or `memo` renamed. */
function optionsKeyed(code: string): string {
    if (!code.includes('by')) return code
    const tokens = tokenize(code)
    const edits: { start: number; end: number; text: string }[] = []
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (
            token.kind !== SyntaxKind.Identifier ||
            !KEYED_CALLS.has(token.text) ||
            tokens[at - 1]?.kind === SyntaxKind.DotToken
        )
            continue
        const open = afterTypeArguments(tokens, at + 1)
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        const options = secondArgument(tokens, open)
        if (tokens[options]?.kind !== SyntaxKind.OpenBraceToken) continue
        const close = closerOf(tokens, options)
        let depth = 0
        for (let index = options + 1; index < close; index += 1) {
            const property = tokens[index] as Token
            depth += nesting(property.kind)
            if (
                depth !== 0 ||
                property.kind !== SyntaxKind.Identifier ||
                property.text !== 'by'
            )
                continue
            const before = (tokens[index - 1] as Token).kind
            if (
                before !== SyntaxKind.OpenBraceToken &&
                before !== SyntaxKind.CommaToken
            )
                continue
            const after = tokens[index + 1]?.kind
            if (
                after === SyntaxKind.ColonToken ||
                after === SyntaxKind.OpenParenToken
            )
                edits.push({
                    start: property.start,
                    end: property.end,
                    text: 'key',
                })
            else if (
                after === SyntaxKind.CommaToken ||
                after === SyntaxKind.CloseBraceToken
            )
                edits.push({
                    start: property.start,
                    end: property.end,
                    text: 'key: by',
                })
        }
    }
    // A call in an earlier call's arguments is reached after it, and its edits sit before.
    edits.sort((first, second) => first.start - second.start)
    let keyed = code
    for (let index = edits.length - 1; index >= 0; index -= 1) {
        const edit = edits[index] as {
            start: number
            end: number
            text: string
        }
        keyed = keyed.slice(0, edit.start) + edit.text + keyed.slice(edit.end)
    }
    return keyed
}

/** The index of the token opening the call's second argument at `open`'s `(`, or -1. */
function secondArgument(tokens: readonly Token[], open: number): number {
    const close = closerOf(tokens, open)
    let depth = 0
    for (let index = open + 1; index < close; index += 1) {
        const kind = (tokens[index] as Token).kind
        depth += nesting(kind)
        if (depth === 0 && kind === SyntaxKind.CommaToken) return index + 1
    }
    return -1
}
