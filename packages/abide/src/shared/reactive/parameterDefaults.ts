// 11.29 — A DEFAULT WRITTEN IN A KEYED BODY'S PARAMETER IS PART OF ITS KEY. `({ page = 1 }) => …`
// runs the same for `{}` and for `{ page: 1 }`, and keyed on the args as passed those were two
// entries and two runs of the body — right in the value, wrong in the work.
//
// READ OFF THE BODY'S OWN SOURCE TEXT, which `Function.prototype.toString` hands back as the
// engine holds it: transpiled on bun and minified in a browser bundle, and in either the pattern
// is still a pattern. The compiler lowers a `.abide` alone, and a keyed body is as often in a `.ts`
// no compile step touches, so this is the one place that reaches every body in every file on
// both sides. A browser's `Rpc` has no handler body to read; the build reads it for the wrapper
// and hands it over through `declareDefaults`.
//
// A LITERAL, OR A REFUSAL. A default is an expression the body evaluates on every call, and only a
// literal can be evaluated without running it — a name, a call or a reactive read cannot, and
// leaving one out of the key is the double entry this file exists to close. Bun inlines a `const`
// of the same module into the text, so `limit = PAGE` reads as the literal it names.

import type { JsonValue } from '../JsonValue.ts'
import { putOwn } from '../putOwn.ts'

/** The members a body's parameter defaults, each beside its literal. */
export type Defaults = { names: string[]; values: JsonValue[] }

// Per body rather than per construction: a server builds a module's value once per request
// (`scoped`), over the one function its module declared.
const READ = new WeakMap<object, Defaults | null>()

// What `literal` hands back for text that is not one — `undefined` is a literal (`void 0`).
const NOT_LITERAL: unique symbol = Symbol('abide.notLiteral')

/**
 * The literal defaults `body`'s destructured parameter writes, or `null` where it writes none.
 *
 * Throws where a default is not a literal (11.29).
 */
export function parameterDefaults(body: object): Defaults | null {
    let read = READ.get(body)
    if (read === undefined) {
        read = defaultsInSource(Function.prototype.toString.call(body))
        READ.set(body, read)
    }
    return read
}

/** Records the defaults the build read for a body whose own text does not carry them. */
export function declareDefaults(body: object, defaults: Defaults): void {
    READ.set(body, defaults)
}

/**
 * `args` with every member the parameter defaults filled where it is `undefined`.
 *
 * `args` itself where nothing was missing, so a caller that passed every member allocates nothing
 * and a second application is free. ABSENT ARGS ARE `{}`: a wire writes the two alike (an empty
 * query), so read apart they are one call keyed two ways by the side it was made on — and a
 * pattern with a default is a record by its own spelling.
 */
export function withDefaults<Args>(args: Args, defaults: Defaults): Args {
    if (args !== undefined && (typeof args !== 'object' || args === null))
        return args
    const given = (args ?? {}) as Record<string, unknown>
    const { names, values } = defaults
    let filled: Record<string, unknown> | null = null
    for (let index = 0; index < names.length; index += 1) {
        const name = names[index] as string
        if (given[name] !== undefined) continue
        filled ??= { ...given }
        const value = values[index]
        // A fresh copy of an object default, as the body's own evaluation makes one per call.
        putOwn(
            filled,
            name,
            typeof value === 'object' && value !== null
                ? structuredClone(value)
                : value,
        )
    }
    return (filled ?? given) as Args
}

/** Where a reader stands in a function's source text. */
type Reader = { text: string; at: number }

/**
 * The literal defaults the first parameter of the function `text` spells, or `null` where none.
 *
 * The build's reader as much as the runtime's, so the two cannot disagree about what a default is.
 */
export function defaultsInSource(text: string): Defaults | null {
    const open = text.indexOf('(')
    // `args => …` — one plain name before any parenthesis. Looked for behind it alone, so a long
    // body is never scanned for an arrow.
    if (open === -1 || text.lastIndexOf('=>', open) !== -1) return null
    const reader: Reader = { text, at: open + 1 }
    space(reader)
    if (text[reader.at] !== '{') return null
    reader.at += 1
    const names: string[] = []
    const values: JsonValue[] = []
    for (;;) {
        space(reader)
        if (text[reader.at] === '}' || text.startsWith('...', reader.at)) break
        const name = key(reader)
        space(reader)
        if (text[reader.at] === ':') {
            reader.at += 1
            space(reader)
            const bound = text[reader.at]
            if (bound === '{' || bound === '[') {
                if (nestedDefault(reader))
                    throw unreadable(
                        name ?? 'a computed member',
                        'a default inside a nested pattern',
                    )
            } else word(reader)
            space(reader)
        }
        if (text[reader.at] === '=') {
            reader.at += 1
            space(reader)
            const start = reader.at
            const value = literal(reader)
            space(reader)
            const next = text[reader.at]
            if (
                name === null ||
                value === NOT_LITERAL ||
                (next !== ',' && next !== '}')
            )
                throw unreadable(
                    name ?? 'a computed member',
                    expressionAt(text, start),
                )
            if (value !== undefined) {
                names.push(name)
                values.push(value)
            }
        }
        space(reader)
        if (text[reader.at] !== ',') break
        reader.at += 1
    }
    return names.length === 0 ? null : { names, values }
}

function unreadable(name: string, what: string): Error {
    return new Error(
        `A keyed body's parameter defaults \`${name}\` to ${what}, which its Args key cannot read. A default in the parameter is part of the key (RULEBOOK 11.29), and only a literal is read without running the body: write the literal, or default \`${name}\` inside the body.`,
    )
}

/** The default's text up to the next member, for the refusal to quote. */
function expressionAt(text: string, start: number): string {
    let depth = 0
    let at = start
    for (; at < text.length; at += 1) {
        const char = text[at]
        if (char === '(' || char === '[' || char === '{') depth += 1
        else if (char === ')' || char === ']' || char === '}') {
            if (depth === 0) break
            depth -= 1
        } else if (char === ',' && depth === 0) break
    }
    return `\`${text.slice(start, at).trim()}\``
}

function space(reader: Reader): void {
    const text = reader.text
    for (;;) {
        const char = text[reader.at]
        if (char === ' ' || char === '\n' || char === '\t' || char === '\r')
            reader.at += 1
        else if (text.startsWith('/*', reader.at))
            reader.at = text.indexOf('*/', reader.at + 2) + 2
        else if (text.startsWith('//', reader.at)) {
            const end = text.indexOf('\n', reader.at)
            reader.at = end === -1 ? text.length : end
        } else return
    }
}

// What ends a name: punctuation, whitespace, and the end of the text.
const DELIMITERS = new Set([
    ' ',
    '\n',
    '\t',
    '\r',
    ',',
    ':',
    '=',
    '{',
    '}',
    '[',
    ']',
    '(',
    ')',
    '"',
    "'",
    '`',
    '/',
])

function word(reader: Reader): string {
    const start = reader.at
    while (
        reader.at < reader.text.length &&
        !DELIMITERS.has(reader.text[reader.at] as string)
    )
        reader.at += 1
    return reader.text.slice(start, reader.at)
}

/** A member's key: a name, a quoted string or a number — or `null`, skipped, where it is computed. */
function key(reader: Reader): string | null {
    const char = reader.text[reader.at]
    if (char === '"' || char === "'") {
        const quoted = string(reader)
        if (quoted !== NOT_LITERAL) return quoted
    }
    if (char === '[') {
        nestedDefault(reader)
        return null
    }
    const name = word(reader)
    return /^[\d.]/.test(name) ? String(Number(name)) : name
}

/** Skips a nested pattern, and says whether it writes a default of its own inside. */
function nestedDefault(reader: Reader): boolean {
    const text = reader.text
    let depth = 0
    let defaulted = false
    while (reader.at < text.length) {
        const char = text[reader.at] as string
        if (char === '"' || char === "'" || char === '`') {
            string(reader)
            continue
        }
        if (char === '{' || char === '[') depth += 1
        else if (char === '}' || char === ']') {
            depth -= 1
            if (depth === 0) {
                reader.at += 1
                return defaulted
            }
        } else if (char === '=') defaulted = true
        reader.at += 1
    }
    return defaulted
}

const NUMBER =
    /-?(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)/y

function literal(reader: Reader): JsonValue | undefined | typeof NOT_LITERAL {
    const text = reader.text
    const char = text[reader.at]
    if (char === '"' || char === "'" || char === '`') return string(reader)
    if (char === '[') {
        reader.at += 1
        const items: JsonValue[] = []
        for (;;) {
            space(reader)
            if (text[reader.at] === ']') break
            const item = literal(reader)
            if (item === NOT_LITERAL || item === undefined) return NOT_LITERAL
            items.push(item)
            space(reader)
            if (text[reader.at] === ',') reader.at += 1
            else if (text[reader.at] !== ']') return NOT_LITERAL
        }
        reader.at += 1
        return items
    }
    if (char === '{') {
        reader.at += 1
        const members: { [name: string]: JsonValue } = {}
        for (;;) {
            space(reader)
            if (text[reader.at] === '}') break
            const name = key(reader)
            space(reader)
            if (name === null || text[reader.at] !== ':') return NOT_LITERAL
            reader.at += 1
            space(reader)
            const member = literal(reader)
            if (member === NOT_LITERAL) return NOT_LITERAL
            if (member !== undefined) putOwn(members, name, member)
            space(reader)
            if (text[reader.at] === ',') reader.at += 1
            else if (text[reader.at] !== '}') return NOT_LITERAL
        }
        reader.at += 1
        return members
    }
    // `!0` and `!1` are how a minifier spells `true` and `false`.
    if (text.startsWith('!0', reader.at) || text.startsWith('!1', reader.at)) {
        reader.at += 2
        return text[reader.at - 1] === '0'
    }
    if (text.startsWith('void 0', reader.at)) {
        reader.at += 6
        return undefined
    }
    NUMBER.lastIndex = reader.at
    const number = NUMBER.exec(text)
    if (number !== null) {
        reader.at += number[0].length
        const spelled = number[0].replaceAll('_', '')
        return spelled.startsWith('-')
            ? -Number(spelled.slice(1))
            : Number(spelled)
    }
    const name = word(reader)
    if (name === 'true') return true
    if (name === 'false') return false
    if (name === 'null') return null
    if (name === 'undefined') return undefined
    return NOT_LITERAL
}

const ESCAPES: Record<string, string> = {
    n: '\n',
    r: '\r',
    t: '\t',
    b: '\b',
    f: '\f',
    v: '\v',
    0: '\0',
}

/** A quoted string, or a template with no substitution in it. */
function string(reader: Reader): string | typeof NOT_LITERAL {
    const text = reader.text
    const quote = text[reader.at]
    let out = ''
    reader.at += 1
    while (reader.at < text.length) {
        const char = text[reader.at] as string
        reader.at += 1
        if (char === quote) return out
        if (quote === '`' && char === '$' && text[reader.at] === '{')
            return NOT_LITERAL
        if (char !== '\\') {
            out += char
            continue
        }
        const escaped = text[reader.at] as string
        reader.at += 1
        if (escaped === 'x') {
            out += String.fromCharCode(
                Number.parseInt(text.slice(reader.at, reader.at + 2), 16),
            )
            reader.at += 2
        } else if (escaped === 'u' && text[reader.at] === '{') {
            const end = text.indexOf('}', reader.at)
            out += String.fromCodePoint(
                Number.parseInt(text.slice(reader.at + 1, end), 16),
            )
            reader.at = end + 1
        } else if (escaped === 'u') {
            out += String.fromCharCode(
                Number.parseInt(text.slice(reader.at, reader.at + 4), 16),
            )
            reader.at += 4
        } else if (escaped === '\n') {
            // A line continuation writes nothing.
        } else out += ESCAPES[escaped] ?? escaped
    }
    return NOT_LITERAL
}
