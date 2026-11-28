// 38.234 — THE MIGRATION OFF A FETCH'S OWN RETRIES: `fetchAndHandle` asks once (54.7), and asking
// again is a `pipe`'s (57.9). In each call whose options are an object literal written in place, a
// `timeout` is the platform's deadline handed as the `signal`, where the call hands none, and
// `retries: 0` — the spelling that only ever turned the old retries off — goes. Every other
// `retries`, a `backoff`, and a `timeout` beside a `signal` is a note (38.226): which pipe the call
// belongs in is the app's to decide.
//
// A SCAN, NOT A PARSE, as `toJob` is. Options built anywhere else are values only the checker can
// follow, and it names each property the type no longer has.

import { SyntaxKind } from 'typescript/unstable/ast'

import { abideBindings } from './hookCalls.ts'
import type { Note } from './Migration.ts'
import {
    lineAround,
    rewriteCode,
    type Splice,
    spliced,
    splicedOffset,
} from './rewriteCode.ts'
import {
    afterTypeArguments,
    argumentCommas,
    closerOf,
    nesting,
    type Token,
    tokenize,
} from './tokenize.ts'

const TO_PIPE =
    'fetchAndHandle asks once: ask again through a pipe([step], { retries, backoff, timeout }), handing the fetch the signal its step is given. RULEBOOK 54.7, 57.9.'

/** 38.234 — `text`, a file at `path`, with each `fetchAndHandle` call's `timeout` and `retries: 0` moved off it. */
export function toFetchOptions(
    text: string,
    path: string,
    note: Note = () => {},
): string {
    return rewriteCode(text, path, {
        word: 'fetchAndHandle',
        module: (code) => optionsMoved(code, note),
    })
}

/** One top-level property of an options literal: its name, and the tokens its value spans. */
type Property = {
    name: string
    /** The name's token. */
    start: number
    /** The value's last token — the name's own where it is shorthand. */
    end: number
    /** The comma after it, or -1 where it is the last. */
    comma: number
    shorthand: boolean
}

function optionsMoved(code: string, note: Note): string {
    const names = new Set<string>()
    for (const [local, imported] of abideBindings([code]))
        if (imported === 'fetchAndHandle') names.add(local)
    if (names.size === 0) return code
    const edits: Splice[] = []
    const noted: number[] = []
    const tokens = tokenize(code)
    for (let at = 0; at < tokens.length; at += 1) {
        const token = tokens[at] as Token
        if (token.kind !== SyntaxKind.Identifier || !names.has(token.text))
            continue
        const before = tokens[at - 1]?.kind
        if (
            before === SyntaxKind.DotToken ||
            before === SyntaxKind.QuestionDotToken
        )
            continue
        const open = afterTypeArguments(tokens, at + 1)
        if (tokens[open]?.kind !== SyntaxKind.OpenParenToken) continue
        const comma = argumentCommas(tokens, open)[0]
        if (comma === undefined) continue
        const brace = comma + 1
        if (tokens[brace]?.kind !== SyntaxKind.OpenBraceToken) continue
        const close = closerOf(tokens, brace)
        if (close === -1) continue
        const properties = propertiesOf(tokens, brace, close)
        const signal = properties.some((property) => property.name === 'signal')
        const drops: Property[] = []
        for (const property of properties) {
            const value = property.shorthand
                ? property.name
                : code.slice(
                      (tokens[property.start + 2] as Token).start,
                      (tokens[property.end] as Token).end,
                  )
            if (property.name === 'retries' && value.trim() === '0')
                drops.push(property)
            else if (property.name === 'timeout' && !signal)
                edits.push({
                    start: (tokens[property.start] as Token).start,
                    end: (tokens[property.end] as Token).end,
                    text: `signal: AbortSignal.timeout(${value})`,
                })
            else if (
                property.name === 'retries' ||
                property.name === 'backoff' ||
                property.name === 'timeout'
            )
                noted.push(token.start)
        }
        if (drops.length > 0 && drops.length === properties.length)
            // Every property dropped: the options go with the comma ahead of them.
            edits.push({
                start: (tokens[comma] as Token).start,
                end: (tokens[close] as Token).end,
                text: '',
            })
        else
            for (const property of drops)
                edits.push(dropSplice(tokens, property))
    }
    const out = spliced(code, edits)
    for (const at of new Set(noted))
        note(lineAround(out, splicedOffset(at, edits)), TO_PIPE)
    return out
}

/** Each property at the top of the object literal whose braces are at `open` and `close`. */
function propertiesOf(
    tokens: readonly Token[],
    open: number,
    close: number,
): Property[] {
    const properties: Property[] = []
    let start = open + 1
    let depth = 0
    for (let at = open + 1; at <= close; at += 1) {
        const kind = (tokens[at] as Token).kind
        const ends =
            at === close || (depth === 0 && kind === SyntaxKind.CommaToken)
        if (!ends) {
            depth += nesting(kind)
            continue
        }
        if (at > start) {
            const name = tokens[start] as Token
            const colon = tokens[start + 1]?.kind === SyntaxKind.ColonToken
            properties.push({
                name: name.kind === SyntaxKind.Identifier ? name.text : '',
                start,
                end: at - 1,
                comma: at === close ? -1 : at,
                shorthand: !colon,
            })
        }
        start = at + 1
    }
    return properties
}

/** The splice taking `property` out with the comma that joins it to its neighbour. */
function dropSplice(tokens: readonly Token[], property: Property): Splice {
    const start = (tokens[property.start] as Token).start
    if (property.comma !== -1)
        return {
            start,
            end: (tokens[property.comma + 1] as Token).start,
            text: '',
        }
    // The last property: the comma ahead of it goes instead.
    const ahead = tokens[property.start - 1] as Token
    return {
        start: ahead.start,
        end: (tokens[property.end] as Token).end,
        text: '',
    }
}
