import type { SemanticToken } from './types/SemanticToken.ts'

/*
Lexical highlighting for the HTML-shaped markup of a `.abide` component — element
and component tag names, attribute names and string values, comments, and the
`<`/`>`/`=` punctuation. A pure scan of raw source (independent of a successful
parse, so it survives mid-edit), it exists so the LSP owns the *structure* too,
not just `{…}` interiors: editors reuse tree-sitter-html as the grammar of record,
which has no production for abide's `attr={expr}` values — a multiline
template-literal attribute (`code={`…`}`) drops it into error recovery that never
re-syncs, miscoloring every element below. Emitting these tokens overrides that
broken parse wherever real structure sits.

`{…}` expression regions (attribute values, interpolations, `{#…}` block heads) and
the raw bodies of `<script>`/`<style>` are skipped here — those are the shadow
type-checker's and the structural block tokenizer's jobs. Lowercase tags get the
`tag` type, uppercase (components) get `type` (a constructor), mirroring the
tree-sitter highlight split.
*/

/* Raw-text elements whose body is JS/CSS, not markup, so the scan jumps past it. */
const RAW_ELEMENTS = new Set(['script', 'style'])

const operator = (start: number, length: number): SemanticToken => ({
    start,
    length,
    type: 'operator',
    modifiers: [],
})

const isNameStart = (char: string): boolean => /[A-Za-z]/.test(char)

/* Characters that end a tag or attribute name. */
const isNameBreak = (char: string): boolean => /[\s=/>{}"'<]/.test(char)

export function markupTokens(source: string): SemanticToken[] {
    const tokens: SemanticToken[] = []
    let cursor = 0
    while (cursor < source.length) {
        const char = source.charAt(cursor)
        /* An expression region — interiors are the shadow classifier's job. */
        if (char === '{') {
            cursor = skipExpression(source, cursor)
            continue
        }
        if (char === '<') {
            if (source.startsWith('<!--', cursor)) {
                const end = source.indexOf('-->', cursor + 4)
                const close = end === -1 ? source.length : end + 3
                tokens.push({
                    start: cursor,
                    length: close - cursor,
                    type: 'comment',
                    modifiers: [],
                })
                cursor = close
                continue
            }
            const isClose = source.charAt(cursor + 1) === '/'
            const nameStart = cursor + (isClose ? 2 : 1)
            if (isNameStart(source.charAt(nameStart))) {
                tokens.push(operator(cursor, isClose ? 2 : 1))
                const name = readName(source, nameStart)
                const type = /[A-Z]/.test(name.charAt(0)) ? 'type' : 'tag'
                tokens.push({ start: nameStart, length: name.length, type, modifiers: [] })
                const afterName = nameStart + name.length
                if (isClose) {
                    cursor = scanToClose(source, afterName, tokens)
                    continue
                }
                const { end, selfClosed } = scanAttributes(source, afterName, tokens)
                cursor =
                    RAW_ELEMENTS.has(name) && !selfClosed ? skipRawBody(source, end, name) : end
                continue
            }
        }
        cursor += 1
    }
    return tokens
}

/* Reads a tag/element name from `start` (letters, digits, `-`, `_`). */
function readName(source: string, start: number): string {
    let cursor = start
    while (cursor < source.length && /[A-Za-z0-9_-]/.test(source.charAt(cursor))) {
        cursor += 1
    }
    return source.slice(start, cursor)
}

/* From after a close tag's name, emits the `>` operator and returns past it. */
function scanToClose(source: string, from: number, tokens: SemanticToken[]): number {
    let cursor = from
    while (cursor < source.length && source.charAt(cursor) !== '>') {
        cursor += 1
    }
    if (cursor < source.length) {
        tokens.push(operator(cursor, 1))
        return cursor + 1
    }
    return cursor
}

/* Scans an open tag's attributes from after its name to the closing `>`/`/>`,
   emitting an `attribute` token per name, `operator` for `=`, and string tokens
   for quoted values; `{…}` values and spreads are left to the shadow. */
function scanAttributes(
    source: string,
    from: number,
    tokens: SemanticToken[],
): { end: number; selfClosed: boolean } {
    let cursor = from
    while (cursor < source.length) {
        const char = source.charAt(cursor)
        if (/\s/.test(char)) {
            cursor += 1
            continue
        }
        if (char === '>') {
            tokens.push(operator(cursor, 1))
            return { end: cursor + 1, selfClosed: false }
        }
        if (char === '/' && source.charAt(cursor + 1) === '>') {
            tokens.push(operator(cursor, 2))
            return { end: cursor + 2, selfClosed: true }
        }
        /* `{…code}` spread / expression attribute — shadow's job. */
        if (char === '{') {
            cursor = skipExpression(source, cursor)
            continue
        }
        const nameStart = cursor
        while (cursor < source.length && !isNameBreak(source.charAt(cursor))) {
            cursor += 1
        }
        if (cursor === nameStart) {
            /* No progress on a stray delimiter — advance to avoid a stall. */
            cursor += 1
            continue
        }
        tokens.push({
            start: nameStart,
            length: cursor - nameStart,
            type: 'attribute',
            modifiers: [],
        })
        let eq = cursor
        while (eq < source.length && /\s/.test(source.charAt(eq))) {
            eq += 1
        }
        if (source.charAt(eq) === '=') {
            tokens.push(operator(eq, 1))
            eq += 1
            while (eq < source.length && /\s/.test(source.charAt(eq))) {
                eq += 1
            }
            cursor = scanAttributeValue(source, eq, tokens)
        } else {
            cursor = eq
        }
    }
    return { end: cursor, selfClosed: false }
}

/* Scans an attribute value: a `{…}` expression (skipped), a quoted string (split
   around any `{…}` interpolations), or a bare unquoted run. Returns past it. */
function scanAttributeValue(source: string, from: number, tokens: SemanticToken[]): number {
    const char = source.charAt(from)
    if (char === '{') {
        return skipExpression(source, from)
    }
    if (char === '"' || char === "'") {
        return scanQuotedValue(source, from, tokens)
    }
    let cursor = from
    /* Unquoted values run to whitespace or `>`; a `/` is part of the value (a URL)
       UNLESS it's the self-close `/>`, so stop before that `/` and leave it for the
       attribute scanner to read as the self-close marker. */
    while (cursor < source.length) {
        const valueChar = source.charAt(cursor)
        if (/[\s>]/.test(valueChar) || (valueChar === '/' && source.charAt(cursor + 1) === '>')) {
            break
        }
        cursor += 1
    }
    if (cursor > from) {
        tokens.push({ start: from, length: cursor - from, type: 'string', modifiers: [] })
    }
    return cursor
}

/* Emits string tokens for the literal runs of a quoted value (delimiters
   included), skipping `{…}` interpolations so the shadow colors their interiors. */
function scanQuotedValue(source: string, start: number, tokens: SemanticToken[]): number {
    const quote = source.charAt(start)
    let segmentStart = start
    let cursor = start + 1
    const flush = (end: number): void => {
        if (end > segmentStart) {
            tokens.push({
                start: segmentStart,
                length: end - segmentStart,
                type: 'string',
                modifiers: [],
            })
        }
    }
    while (cursor < source.length) {
        const char = source.charAt(cursor)
        if (char === quote) {
            flush(cursor + 1)
            return cursor + 1
        }
        if (char === '{') {
            flush(cursor)
            cursor = skipExpression(source, cursor)
            segmentStart = cursor
            continue
        }
        cursor += 1
    }
    flush(cursor)
    return cursor
}

/* From the close `>` of a raw-text element's open tag, returns the index of its
   `</tag` so the close tag is scanned as markup but the body is left untouched. */
function skipRawBody(source: string, from: number, tag: string): number {
    const close = source.indexOf(`</${tag}`, from)
    return close === -1 ? source.length : close
}

/* From the opening `{` at `start`, returns the index past the matching `}`,
   tracking nested braces and skipping strings, template literals (with `${…}`),
   and JS comments so their contents never sway the depth. A regex literal holding
   an unbalanced brace is the one unhandled case — rare, accepted for a highlighter. */
function skipExpression(source: string, start: number): number {
    let depth = 0
    let cursor = start
    while (cursor < source.length) {
        const char = source.charAt(cursor)
        if (char === '"' || char === "'") {
            cursor = skipString(source, cursor)
            continue
        }
        if (char === '`') {
            cursor = skipTemplate(source, cursor)
            continue
        }
        if (char === '/' && source.charAt(cursor + 1) === '/') {
            const newline = source.indexOf('\n', cursor)
            cursor = newline === -1 ? source.length : newline
            continue
        }
        if (char === '/' && source.charAt(cursor + 1) === '*') {
            const end = source.indexOf('*/', cursor + 2)
            cursor = end === -1 ? source.length : end + 2
            continue
        }
        if (char === '{') {
            depth += 1
        } else if (char === '}') {
            depth -= 1
            if (depth === 0) {
                return cursor + 1
            }
        }
        cursor += 1
    }
    return cursor
}

/* From the opening quote at `start`, returns the index past the matching quote;
   a backslash escapes the next character. */
function skipString(source: string, start: number): number {
    const quote = source.charAt(start)
    let cursor = start + 1
    while (cursor < source.length) {
        const char = source.charAt(cursor)
        if (char === '\\') {
            cursor += 2
            continue
        }
        if (char === quote) {
            return cursor + 1
        }
        cursor += 1
    }
    return cursor
}

/* From the opening backtick at `start`, returns the index past the matching
   backtick. `${…}` re-enters expression scanning so its inner braces balance;
   braces in the literal text are ignored. */
function skipTemplate(source: string, start: number): number {
    let cursor = start + 1
    while (cursor < source.length) {
        const char = source.charAt(cursor)
        if (char === '\\') {
            cursor += 2
            continue
        }
        if (char === '`') {
            return cursor + 1
        }
        if (char === '$' && source.charAt(cursor + 1) === '{') {
            cursor = skipExpression(source, cursor + 1)
            continue
        }
        cursor += 1
    }
    return cursor
}
