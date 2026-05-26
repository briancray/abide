/*
Scans a module source character-by-character — skipping strings,
templates, comments, and TypeScript generics — for an
`export const <name> = <IDENT>(...)` binding the caller cares about.
On a match returns the identifier text, the export name, and the byte
ranges of the call's open and close parens; the $rpc and $sockets
rewriters splice their runtime bindings into those ranges.

The scanner enforces a single matching export per module: a second match
throws `singleExportError` so each $rpc / $sockets file is required to
declare exactly one remote function / socket.

A regex pass would be tidier but it can't tell a `GET` mention inside a
docstring or template literal from the real call, and it can't follow
nested generics like `GET<Map<K, V>>(`.
*/

export type ExportCallSite = {
    ident: string
    exportName: string
    callStart: number
    parenStart: number
    parenEnd: number
}

export function findExportCallSite(
    source: string,
    matchIdent: (ident: string) => boolean,
    singleExportError: string,
): ExportCallSite | undefined {
    let found: ExportCallSite | undefined
    const len = source.length
    let i = 0
    while (i < len) {
        const c = source[i]
        const next = source[i + 1]
        if (c === '/' && next === '/') {
            const newline = source.indexOf('\n', i + 2)
            i = newline === -1 ? len : newline + 1
            continue
        }
        if (c === '/' && next === '*') {
            const end = source.indexOf('*/', i + 2)
            i = end === -1 ? len : end + 2
            continue
        }
        if (c === '"' || c === "'") {
            i = skipString(source, i + 1, c)
            continue
        }
        if (c === '`') {
            i = skipTemplate(source, i + 1)
            continue
        }
        if (isIdentStart(c) && !isIdentPart(source[i - 1])) {
            let j = i + 1
            while (j < len && isIdentPart(source[j])) {
                j++
            }
            const ident = source.slice(i, j)
            if (matchIdent(ident)) {
                const tail = matchCallTail(source, j)
                if (tail !== undefined) {
                    const exportName = detectExportName(source, i)
                    if (exportName !== undefined) {
                        if (found !== undefined) {
                            throw new Error(singleExportError)
                        }
                        const parenEnd = findCallEnd(source, tail)
                        if (parenEnd === undefined) {
                            throw new Error(`[belte] unmatched \`(\` after \`${ident}\` identifier`)
                        }
                        found = {
                            ident,
                            exportName,
                            callStart: i,
                            parenStart: tail,
                            parenEnd,
                        }
                        i = parenEnd + 1
                        continue
                    }
                }
            }
            i = j
            continue
        }
        i++
    }
    return found
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
        if (c === '"' || c === "'") {
            i = skipString(source, i + 1, c)
            continue
        }
        if (c === '`') {
            i = skipTemplate(source, i + 1)
            continue
        }
        if (c === '/' && source[i + 1] === '/') {
            const newline = source.indexOf('\n', i + 2)
            i = newline === -1 ? source.length : newline + 1
            continue
        }
        if (c === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2)
            i = end === -1 ? source.length : end + 2
            continue
        }
        i++
    }
    return i
}

function matchCallTail(source: string, after: number): number | undefined {
    let j = after
    while (j < source.length && isWhitespace(source[j])) {
        j++
    }
    if (source[j] === '<') {
        const closed = skipGenerics(source, j)
        if (closed === undefined) {
            return undefined
        }
        j = closed
        while (j < source.length && isWhitespace(source[j])) {
            j++
        }
    }
    return source[j] === '(' ? j : undefined
}

/*
Returns the index immediately after the matching `>` for a generic
argument list starting at `start`. TypeScript type literals inside the
generic (`<{ a: string; b: number }>`, function types `<() => X>`,
tuples `<[A, B]>`, etc.) bring their own paired brackets and
semicolons, so track depth across `<>`, `()`, `{}`, and `[]` and only
count a closing `>` when every other bracket is balanced.
Arrow-function `=>` is treated as a single token so the `>` doesn't
prematurely close the generic.
*/
function skipGenerics(source: string, start: number): number | undefined {
    let angleDepth = 0
    let parenDepth = 0
    let braceDepth = 0
    let bracketDepth = 0
    let i = start
    while (i < source.length) {
        const c = source[i]
        if (c === '"' || c === "'") {
            i = skipString(source, i + 1, c)
            continue
        }
        if (c === '`') {
            i = skipTemplate(source, i + 1)
            continue
        }
        if (c === '<') {
            angleDepth++
        } else if (c === '>') {
            const isArrow = source[i - 1] === '='
            if (!isArrow && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
                angleDepth--
                if (angleDepth === 0) {
                    return i + 1
                }
            }
        } else if (c === '(') {
            parenDepth++
        } else if (c === ')') {
            parenDepth--
        } else if (c === '{') {
            braceDepth++
        } else if (c === '}') {
            braceDepth--
        } else if (c === '[') {
            bracketDepth++
        } else if (c === ']') {
            bracketDepth--
        }
        i++
    }
    return undefined
}

/*
Walks the call body, skipping strings/templates/comments and respecting
nested `()` so brackets inside object literals or nested calls don't
throw the depth count.
*/
function findCallEnd(source: string, parenStart: number): number | undefined {
    let depth = 1
    let i = parenStart + 1
    while (i < source.length) {
        const c = source[i]
        if (c === '"' || c === "'") {
            i = skipString(source, i + 1, c)
            continue
        }
        if (c === '`') {
            i = skipTemplate(source, i + 1)
            continue
        }
        if (c === '/' && source[i + 1] === '/') {
            const newline = source.indexOf('\n', i + 2)
            i = newline === -1 ? source.length : newline + 1
            continue
        }
        if (c === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2)
            i = end === -1 ? source.length : end + 2
            continue
        }
        if (c === '(') {
            depth++
        } else if (c === ')') {
            depth--
            if (depth === 0) {
                return i
            }
        }
        i++
    }
    return undefined
}

/*
Looks backwards from a `<IDENT>(` callStart to confirm it was bound by
`export const <name> = ...`. Returns the identifier in `<name>` if so,
undefined otherwise — used to skip mentions of an identifier that
isn't the module's declared export.
*/
function detectExportName(source: string, callStart: number): string | undefined {
    let i = callStart - 1
    while (i >= 0 && isWhitespace(source[i])) {
        i--
    }
    if (source[i] !== '=') {
        return undefined
    }
    i--
    while (i >= 0 && isWhitespace(source[i])) {
        i--
    }
    const nameEnd = i + 1
    while (i >= 0 && isIdentPart(source[i])) {
        i--
    }
    const nameStart = i + 1
    if (nameStart === nameEnd) {
        return undefined
    }
    const name = source.slice(nameStart, nameEnd)
    while (i >= 0 && isWhitespace(source[i])) {
        i--
    }
    if (!matchesBackwards(source, i, 'const')) {
        return undefined
    }
    i -= 'const'.length
    while (i >= 0 && isWhitespace(source[i])) {
        i--
    }
    if (!matchesBackwards(source, i, 'export')) {
        return undefined
    }
    return name
}

function matchesBackwards(source: string, end: number, keyword: string): boolean {
    const start = end - keyword.length + 1
    if (start < 0) {
        return false
    }
    if (source.slice(start, end + 1) !== keyword) {
        return false
    }
    return start === 0 || !isIdentPart(source[start - 1])
}

function isIdentStart(c: string | undefined): boolean {
    if (c === undefined) {
        return false
    }
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '$'
}

function isIdentPart(c: string | undefined): boolean {
    if (c === undefined) {
        return false
    }
    return isIdentStart(c) || (c >= '0' && c <= '9')
}

function isWhitespace(c: string | undefined): boolean {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r'
}
