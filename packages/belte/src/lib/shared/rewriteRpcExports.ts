import type { HttpVerb } from '../types/HttpVerb.ts'

const VERB_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
const VERB_SET = new Set<string>(VERB_NAMES)

type RpcSite = {
    verb: HttpVerb
    exportName: string
    callStart: number
    parenStart: number
}

/*
Scans an `$rpc/**` module and locates its `export const <name> = handler.VERB(...)`
binding. Returns the verb, the export name, and the byte range of the
`handler.VERB(` call so the rewriters can splice in the runtime
implementation. Verb is extracted from the property name (`.GET`/`.POST`/…),
the export name from the surrounding `export const <name> = ` binding.

A regex pass would be tidier but it can't tell a `handler.GET` mention
inside a docstring or template literal from the real call, and it can't
follow nested generics like `handler.GET<Map<K, V>>(`.

Each file must contain exactly one such export; the bundler also checks
that the export name matches the file's stem so the URL (file path) and
the call-site name stay aligned.
*/
export function findRpcCallSite(source: string): RpcSite | undefined {
    let found: RpcSite | undefined
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
            if (source.slice(i, j) === 'handler') {
                const verbProbe = matchVerbProperty(source, j)
                if (verbProbe !== undefined) {
                    const tail = matchCallTail(source, verbProbe.after)
                    if (tail !== undefined) {
                        const exportName = detectExportName(source, i)
                        if (exportName !== undefined) {
                            if (found !== undefined) {
                                throw new Error(
                                    '[belte] $rpc module contains more than one `handler.<VERB>(...)` export — each file must declare exactly one remote function',
                                )
                            }
                            found = {
                                verb: verbProbe.verb,
                                exportName,
                                callStart: i,
                                parenStart: tail,
                            }
                        }
                        i = tail + 1
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

/*
Rewrites an `$rpc/**` module for the server bundle: strips the handler
import line and replaces the `handler.VERB(` call with
`__belteDefineVerb__("VERB", "<url>", `. Generics on the handler call are
discarded — they carry no runtime info and the verb/url come from the
file path + handler method instead.
*/
export function rewriteForServer(source: string, url: string): string {
    const stripped = stripHandlerImport(source)
    const site = findRpcCallSite(stripped)
    if (!site) {
        return stripped
    }
    return (
        stripped.slice(0, site.callStart) +
        `__belteDefineVerb__(${JSON.stringify(site.verb)}, ${JSON.stringify(url)}, ` +
        stripped.slice(site.parenStart + 1)
    )
}

/*
Reads the module to discover the declared verb and export name without
emitting any rewritten source. The client bundle uses this to emit a
single remoteProxy stub with the same export name the source declared.
*/
export function extractRpcExport(
    source: string,
): { verb: HttpVerb; exportName: string } | undefined {
    const site = findRpcCallSite(source)
    if (!site) {
        return undefined
    }
    return { verb: site.verb, exportName: site.exportName }
}

function stripHandlerImport(source: string): string {
    const pattern =
        /^\s*import\s*\{[^}]*\bhandler\b[^}]*\}\s*from\s*['"]belte\/rpc\/handler['"]\s*;?\s*$/gm
    return source.replace(pattern, '')
}

function matchVerbProperty(
    source: string,
    after: number,
): { verb: HttpVerb; after: number } | undefined {
    let j = after
    while (j < source.length && isWhitespace(source[j])) {
        j++
    }
    if (source[j] !== '.') {
        return undefined
    }
    j++
    while (j < source.length && isWhitespace(source[j])) {
        j++
    }
    const start = j
    while (j < source.length && isIdentPart(source[j])) {
        j++
    }
    const name = source.slice(start, j)
    if (!VERB_SET.has(name)) {
        return undefined
    }
    return { verb: name as HttpVerb, after: j }
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
argument list starting at `start` (which must point at `<`). TypeScript
type literals inside the generic (`<{ a: string; b: number }>`, function
types `<() => X>`, tuples `<[A, B]>`, etc.) bring along their own paired
brackets and semicolons, so we track depth across `<>`, `()`, `{}`, and
`[]` and only count a closing `>` when every other bracket is balanced.
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
