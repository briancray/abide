import { isAsciiWhitespace } from './isAsciiWhitespace.ts'
import { isIdentPart } from './isIdentPart.ts'

/*
The shared "skip a non-code construct" primitive for the source scanners
(findExportCallSite, prepareRpcModule's arg walker, …). When `i` sits on the
start of a string, template literal, line/block comment, or regex literal, it
returns the index immediately after that construct; undefined when `source[i]`
begins ordinary code — including a `/` that's division rather than a regex.

Centralising the string / template / regex / comment rules here is what lets
every scanner walk source depth-aware without re-deriving them and getting the
regex-vs-division or `${…}` edge cases subtly wrong (the bug that made a naive
arg walker miscount a `{ ratio: a / b }` or a regex literal in the opts).
*/
export function skipNonCode(source: string, i: number): number | undefined {
    const c = source[i]
    if (c === '"' || c === "'") {
        return skipString(source, i + 1, c)
    }
    if (c === '`') {
        return skipTemplate(source, i + 1)
    }
    if (c === '/') {
        return skipSlashConstruct(source, i)
    }
    return undefined
}

function skipString(source: string, start: number, quote: string): number {
    let i = start
    while (i < source.length) {
        const c = source[i]
        if (c === '\\') {
            i += 2
            continue
        }
        if (c === quote) {
            return i + 1
        }
        if (c === '\n') {
            return i
        }
        i++
    }
    return source.length
}

function skipTemplate(source: string, start: number): number {
    let i = start
    while (i < source.length) {
        const c = source[i]
        if (c === '\\') {
            i += 2
            continue
        }
        if (c === '`') {
            return i + 1
        }
        if (c === '$' && source[i + 1] === '{') {
            i = skipTemplateExpression(source, i + 2)
            continue
        }
        i++
    }
    return source.length
}

function skipTemplateExpression(source: string, start: number): number {
    let depth = 1
    let i = start
    while (i < source.length && depth > 0) {
        const c = source[i]
        if (c === '{') {
            depth++
            i++
            continue
        }
        if (c === '}') {
            depth--
            i++
            continue
        }
        const skipped = skipNonCode(source, i)
        if (skipped !== undefined) {
            i = skipped
            continue
        }
        i++
    }
    return i
}

/*
When `i` sits on a `/` introducing a line comment, block comment, or regex
literal, returns the index immediately after the construct; undefined when the
`/` is division (or `i` isn't a `/`). One statement of the skip rules shared by
every scanner loop so they can't drift.
*/
function skipSlashConstruct(source: string, i: number): number | undefined {
    if (source[i] !== '/') {
        return undefined
    }
    const next = source[i + 1]
    if (next === '/') {
        const newline = source.indexOf('\n', i + 2)
        return newline === -1 ? source.length : newline + 1
    }
    if (next === '*') {
        const end = source.indexOf('*/', i + 2)
        return end === -1 ? source.length : end + 2
    }
    if (isRegexContext(source, i)) {
        return skipRegex(source, i + 1)
    }
    return undefined
}

/*
A `/` starts a regex literal when the prior expression context expects an
expression rather than a value — after an open delimiter, operator, or
expression-prefix keyword (return, typeof, instanceof, in, of, delete, void,
await, yield, new, throw, case, do). Otherwise `/` is division. Without this
disambiguation a regex like `/^\//` reads as `/` (division), then `^`, `\`,
`/`, `/` — and the final `//` pair fakes a line comment that swallows the rest
of the line, eating any `)` that closes the enclosing call.
*/
const REGEX_PREFIX_KEYWORDS = new Set([
    'return',
    'typeof',
    'instanceof',
    'in',
    'of',
    'delete',
    'void',
    'await',
    'yield',
    'new',
    'throw',
    'case',
    'do',
])

const REGEX_PUNCTUATION = new Set([
    '(',
    '[',
    '{',
    ',',
    ';',
    ':',
    '?',
    '!',
    '&',
    '|',
    '^',
    '~',
    '+',
    '-',
    '*',
    '%',
    '<',
    '>',
    '=',
    '/',
])

function isRegexContext(source: string, slashIndex: number): boolean {
    let i = slashIndex - 1
    while (i >= 0 && isAsciiWhitespace(source[i])) {
        i--
    }
    if (i < 0) {
        return true
    }
    const prev = source[i] as string
    if (REGEX_PUNCTUATION.has(prev)) {
        return true
    }
    if (isIdentPart(prev)) {
        let start = i
        while (start > 0 && isIdentPart(source[start - 1])) {
            start--
        }
        return REGEX_PREFIX_KEYWORDS.has(source.slice(start, i + 1))
    }
    return false
}

/*
Walks past a regex literal body, respecting character classes (`[...]` where
`/` is literal) and backslash escapes, then consumes trailing flag identifiers.
Returns the index immediately after the regex. An unterminated regex (newline
before the closing `/`) returns the newline position so the outer scanner can
resume normally on the next line.
*/
function skipRegex(source: string, start: number): number {
    let i = start
    let inClass = false
    while (i < source.length) {
        const c = source[i]
        if (c === '\\') {
            i += 2
            continue
        }
        if (c === '\n') {
            return i
        }
        if (inClass) {
            if (c === ']') {
                inClass = false
            }
            i++
            continue
        }
        if (c === '[') {
            inClass = true
            i++
            continue
        }
        if (c === '/') {
            let j = i + 1
            while (j < source.length && isIdentPart(source[j])) {
                j++
            }
            return j
        }
        i++
    }
    return source.length
}
