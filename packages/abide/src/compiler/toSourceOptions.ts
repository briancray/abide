// 38.227 — THE MIGRATION TO A SOURCE'S OPTIONS: `poll` is gone, and a `memo`'s or a handler's `ttl`
// takes its place — an entry something reads is refreshed once its life runs out, and one nothing
// reads is let go (6.1, 6.2). A `poll` written as a number, or as `{ every }` without a `delay`, is a
// `ttl` of that many milliseconds, and its `after: 'settle'` is what a `ttl` already counts from (6.3).
// Whether the work had to run while nothing read it is the app's to say, so each one converted is a
// note (38.226); one with a `delay` was scheduling work, which is a `job`'s, and is a note alone.
//
// `reactive` AND `reactive.derived` TAKE NONE OF A SOURCE'S OPTIONS (11.81), and moving one onto a
// `memo` changes what the body reruns on (11.6) — so each is a note, naming the replacement. It runs
// after 38.228, so a `computed` it notes is already spelled `reactive.derived`, the line its note names;
// the note itself names `reactive`, as 38.233 leaves the line before the notes are printed.

import { SyntaxKind } from 'typescript/unstable/ast'

import { abideBindings } from './hookCalls.ts'
import {
    lineAround,
    rewriteCode,
    type Splice,
    spliced,
    splicedOffset,
} from './rewriteCode.ts'
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
/** What takes none of them: `reactive`, and `reactive.derived` — `computed` as 38.228 leaves it. */
const VALUE = 'reactive'
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
    'poll with a delay scheduled work whether or not anything read it, and poll is gone: make it a job writing the memo — job({ every, run }) — or a ttl. RULEBOOK 54.11, 38.227.'
const VALUE_OPTIONS_UNREAD =
    'these options are not written out here, so whether they carry a ttl, throttle, debounce, tags, global or poll cannot be read: reactive takes none of them — move any onto a memo, read through reactive(() => m(args)), or make the value a memo (handlers serve one, never a Reactive). RULEBOOK 11.81, 16.109, 38.227.'
const VALUE_TAKES_NONE =
    'reactive takes no ttl, throttle, debounce, tags, global or poll: declare them on a memo and read it through reactive(() => m(args)), whose body then reruns only for its args. Work that has to run whether or not anything reads it is a job. RULEBOOK 11.6, 11.81, 38.227.'

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

/** One property of an options object written inline: its key's token and its value's span. */
type Property = { key: Token; from: number; to: number }

function moved(code: string, note: Note): string {
    const named = new Map<string, string>()
    for (const [local, imported] of abideBindings([code]))
        if (SOURCES.has(imported) || imported === VALUE)
            named.set(local, imported)
    if (named.size === 0) return code
    const tokens = tokenize(code)
    const edits: Splice[] = []
    const noted: { at: number; message: string }[] = []
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        const factory =
            token.kind === SyntaxKind.Identifier
                ? named.get(token.text)
                : undefined
        if (factory === undefined) continue
        if (tokens[at - 1]?.kind === SyntaxKind.DotToken) continue
        // `reactive.derived(…)` is the value form's sibling, and takes what it takes.
        const derived =
            factory === VALUE &&
            tokens[at + 1]?.kind === SyntaxKind.DotToken &&
            tokens[at + 2]?.text === 'derived'
        const open = afterTypeArguments(tokens, derived ? at + 3 : at + 1)
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        const commas = argumentCommas(tokens, open)
        const second = commas[0]
        if (second === undefined) continue
        const properties = propertiesAt(tokens, second + 1)
        if (factory === VALUE) {
            if (properties?.some(({ key }) => SOURCED.has(key.text)))
                noted.push({ at: token.start, message: VALUE_TAKES_NONE })
            // A name, a call or a spread: what it carries is not on the page to read.
            else if (properties === undefined || spreads(tokens, second + 1))
                noted.push({ at: token.start, message: VALUE_OPTIONS_UNREAD })
            continue
        }
        if (properties === undefined) continue
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
    const out = spliced(code, edits)
    // Where each noted call stands once every edit ahead of it has moved it.
    for (const { at, message } of noted)
        note(lineAround(out, splicedOffset(at, edits)), message)
    return out
}

/** Whether the object written inline at `open` spreads another into itself, at its own depth. */
function spreads(tokens: Token[], open: number): boolean {
    const close = closerOf(tokens, open)
    let depth = 0
    for (let at = open + 1; at < close; at += 1) {
        const kind = (tokens[at] as Token).kind
        if (depth === 0 && kind === SyntaxKind.DotDotDotToken) return true
        depth += nesting(kind)
    }
    return false
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
