// 38.227 — THE MIGRATION TO A SOURCE'S OPTIONS: `poll` is gone, and a `memo`'s or a handler's `ttl`
// takes its place — an entry something reads is refreshed once its life runs out, and one nothing
// reads is let go (6.1, 6.2). A `poll` written as a number, or as `{ every }` without a `delay`, is a
// `ttl` of that many milliseconds, and its `after: 'settle'` is what a `ttl` already counts from (6.3).
// Whether the work had to run while nothing read it is the app's to say, so each one converted is a
// note (38.226); one with a `delay` was scheduling work, which is a `job`'s, and is a note alone.
//
// `reactive` AND `computed` TAKE NONE OF A SOURCE'S OPTIONS (11.81), and moving one onto a `memo`
// changes what the body reruns on (11.6) — so each is a note, naming the replacement.

import { SyntaxKind } from 'typescript/unstable/ast'

import { isAbideSpecifier } from './hookCalls.ts'
import { rewriteCode } from './rewriteCode.ts'
import { importStatements } from './splitImports.ts'
import type { Note } from './toFetchAndHandle.ts'
import {
    afterTypeArguments,
    argumentCommas,
    closerOf,
    nesting,
    type Token,
    tokenize,
} from './tokenize.ts'

/** What declares a source's options: a `memo`, and a handler over a body. */
const SOURCES = new Set(['memo', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
/** What takes none of them. */
const VALUES = new Set(['reactive', 'computed'])
export const SOURCED = new Set([
    'ttl',
    'throttle',
    'debounce',
    'tags',
    'global',
    'poll',
])

const POLL_IS_TTL =
    'poll is now ttl: this entry is refreshed only while something reads it, and let go when nothing does. Work that has to run whether or not anything reads it is a job writing the memo: job({ every, run }). RULEBOOK 6.1, 38.227.'
const POLL_IS_A_JOB =
    'poll with a delay scheduled work whether or not anything read it, and poll is gone: make it a job writing the memo — job({ every, run }) — or a ttl. RULEBOOK 54.14, 38.227.'
const VALUE_TAKES_NONE =
    'reactive and computed take no ttl, throttle, debounce, tags, global or poll: declare them on a memo and read it through a computed — computed(() => m(args)) — whose body then reruns only for its args. Work that has to run whether or not anything reads it is a job. RULEBOOK 11.6, 11.81, 38.227.'

/** 38.227 — `text`, a file at `path`, with each `poll` a `ttl`, and every line it cannot move noted. */
export function toSourceOptions(
    text: string,
    path: string,
    note: Note = () => {},
): string {
    return rewriteCode(text, path, {
        word: ':',
        module: (code) => moved(code, note),
    })
}

type Edit = { start: number; end: number; text: string }

/** One property of an options object written inline: its key's token and its value's span. */
type Property = { key: Token; from: number; to: number }

function moved(code: string, note: Note): string {
    const named = new Map<string, string>()
    for (const statement of importStatements(code))
        if (isAbideSpecifier(statement.specifier))
            for (const binding of statement.bindings)
                if (
                    !binding.typeOnly &&
                    (SOURCES.has(binding.imported) ||
                        VALUES.has(binding.imported))
                )
                    named.set(binding.local, binding.imported)
    if (named.size === 0) return code
    const tokens = tokenize(code)
    const edits: Edit[] = []
    const noted: { at: number; message: string }[] = []
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        const factory =
            token.kind === SyntaxKind.Identifier
                ? named.get(token.text)
                : undefined
        if (factory === undefined) continue
        if (tokens[at - 1]?.kind === SyntaxKind.DotToken) continue
        const open = afterTypeArguments(tokens, at + 1)
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        const commas = argumentCommas(tokens, open)
        const second = commas[0]
        if (second === undefined) continue
        const properties = propertiesAt(tokens, second + 1)
        if (properties === undefined) continue
        if (VALUES.has(factory)) {
            if (properties.some(({ key }) => SOURCED.has(key.text)))
                noted.push({ at: token.start, message: VALUE_TAKES_NONE })
            continue
        }
        const poll = properties.find(({ key }) => key.text === 'poll')
        if (poll === undefined) continue
        const every = everyOf(tokens, poll)
        if (
            every === null ||
            properties.some(({ key }) => key.text === 'ttl')
        ) {
            noted.push({ at: poll.key.start, message: POLL_IS_A_JOB })
            continue
        }
        const end = (tokens[poll.to - 1] as Token).end
        edits.push({
            start: poll.key.start,
            end,
            text: `ttl: ${code.slice((tokens[every.from] as Token).start, (tokens[every.to - 1] as Token).end)}`,
        })
        noted.push({ at: poll.key.start, message: POLL_IS_TTL })
    }
    edits.sort((left, right) => left.start - right.start)
    let out = code
    for (let index = edits.length - 1; index >= 0; index -= 1) {
        const edit = edits[index] as Edit
        out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`
    }
    // Where each noted call stands once every edit ahead of it has moved it.
    for (const { at, message } of noted) {
        let shifted = at
        for (const edit of edits)
            if (edit.end <= at)
                shifted += edit.text.length - (edit.end - edit.start)
        const lineStart = out.lastIndexOf('\n', shifted - 1) + 1
        const lineEnd = out.indexOf('\n', shifted)
        note(
            out.slice(lineStart, lineEnd === -1 ? undefined : lineEnd),
            message,
        )
    }
    return out
}

/**
 * The properties of the object written inline at `open`, or `undefined` where none is. A shorthand
 * property's value is its key.
 */
export function propertiesAt(
    tokens: Token[],
    open: number,
): Property[] | undefined {
    if (tokens[open]?.kind !== SyntaxKind.OpenBraceToken) return undefined
    const close = closerOf(tokens, open)
    const properties: Property[] = []
    let at = open + 1
    while (at < close) {
        const key = tokens[at] as Token
        let end = at
        let depth = 0
        // To the next comma at the object's own depth, or its close.
        while (end < close) {
            const kind = (tokens[end] as Token).kind
            depth += nesting(kind)
            if (depth === 0 && kind === SyntaxKind.CommaToken) break
            end += 1
        }
        // A key is a name, a keyword among them — `global` scans as one — or a string.
        if (
            /^[A-Za-z_$][\w$]*$/.test(key.text) ||
            key.kind === SyntaxKind.StringLiteral
        ) {
            const colon = tokens[at + 1]?.kind === SyntaxKind.ColonToken
            properties.push({
                key: { ...key, text: key.text.replace(/^['"]|['"]$/g, '') },
                from: colon ? at + 2 : at,
                to: end,
            })
        }
        at = end + 1
    }
    return properties
}

/**
 * The span a `poll`'s interval is written in: its value where it is no object, and its `every` where
 * it is one declaring no `delay`. `null` where it declares a `delay`, or names no `every`.
 */
function everyOf(
    tokens: Token[],
    poll: Property,
): { from: number; to: number } | null {
    if (tokens[poll.from]?.kind !== SyntaxKind.OpenBraceToken)
        return { from: poll.from, to: poll.to }
    const inner = propertiesAt(tokens, poll.from) ?? []
    if (inner.some(({ key }) => key.text === 'delay')) return null
    const every = inner.find(({ key }) => key.text === 'every')
    return every === undefined ? null : { from: every.from, to: every.to }
}
