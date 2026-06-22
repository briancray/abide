import type { Segment } from './types/Segment.ts'

/*
Splits a `.abide` source into ordered segments without losing a byte: markup,
comments, and whitespace stay in `raw` segments; `<script>`/`<style>` bodies and
`{…}` interpolations become embeddable segments the printer reformats. A single
stateful scan tracks whether the cursor sits in text flow or inside a tag so a
brace is read as an expression only where abide treats it as one — never inside a
quoted attribute value, a comment, or a script/style body. Mirrors the brace and
quote awareness of the compiler's parseTemplate so the two never diverge.
*/
export function scanRegions(source: string): Segment[] {
    const segments: Segment[] = []
    const length = source.length
    let cursor = 0
    // Start of the pending run of raw markup, flushed before each embeddable span.
    let rawStart = 0
    // 'text' = element flow (a `{` is an interpolation); 'tag' = inside `<…>` (a
    // `{` after `=` is an attribute expression, quotes shield literal braces).
    let state: 'text' | 'tag' = 'text'

    /* Emits the pending raw run `[rawStart, end)` if non-empty. */
    function flushRaw(end: number): void {
        if (end > rawStart) {
            segments.push({ kind: 'raw', value: source.slice(rawStart, end), start: rawStart, end })
        }
    }

    /* From a `{` at `cursor`, returns the index of the matching `}`, tracking string
       literals and nested braces so a `}` inside a string or nested object closes
       nothing. An unterminated expression runs to end. */
    function matchBrace(): number {
        let position = cursor + 1
        let depth = 1
        while (position < length && depth > 0) {
            const char = source.charAt(position)
            if (char === '"' || char === "'" || char === '`') {
                position += 1
                while (position < length && source.charAt(position) !== char) {
                    if (source.charAt(position) === '\\') {
                        position += 1
                    }
                    position += 1
                }
            } else if (char === '{') {
                depth += 1
            } else if (char === '}') {
                depth -= 1
            }
            position += 1
        }
        return position - 1
    }

    /* Reads the `{…}` at `cursor` into an `expr` segment spanning the whole braced
       run and carrying the trimmed code; the printer re-emits the hugging braces, so
       inner padding is normalised away. An empty/whitespace expression is left in the
       raw flow untouched (`{}` is not an expression). */
    function readExpression(): void {
        const close = matchBrace()
        const code = source.slice(cursor + 1, close).trim()
        if (code === '') {
            cursor = close + 1
            return
        }
        flushRaw(cursor)
        segments.push({ kind: 'expr', value: code, start: cursor, end: close + 1 })
        rawStart = close + 1
        cursor = close + 1
    }

    /* Reads a `<script>`/`<style>` element at `cursor` into its own segment: open
       tag and close tag kept verbatim, body handed to the printer for the named
       sub-language. An unterminated element runs to end (no close tag). */
    /* Index of the `>` that ends the open tag at `from`, skipping any `>` inside a quoted
       attribute value so `<script data-x="a > b">` isn't cut mid-tag. Runs to end if
       unterminated. Mirrors the quote awareness the rest of the scan already applies. */
    function openTagEnd(from: number): number {
        let position = from
        while (position < length) {
            const char = source.charAt(position)
            if (char === '"' || char === "'") {
                position += 1
                while (position < length && source.charAt(position) !== char) {
                    position += 1
                }
            } else if (char === '>') {
                return position
            }
            position += 1
        }
        return length
    }

    function readRawBodyElement(kind: 'script' | 'style', closeTag: string): void {
        const openEnd = openTagEnd(cursor)
        const bodyStart = openEnd + 1
        const closeIndex = source.indexOf(closeTag, bodyStart)
        const end = closeIndex === -1 ? length : closeIndex + closeTag.length
        flushRaw(cursor)
        segments.push({
            kind,
            open: source.slice(cursor, bodyStart),
            body: source.slice(bodyStart, closeIndex === -1 ? length : closeIndex),
            close: closeIndex === -1 ? '' : closeTag,
            start: cursor,
            end,
        })
        rawStart = end
        cursor = end
    }

    while (cursor < length) {
        const char = source.charAt(cursor)
        if (state === 'text') {
            if (source.startsWith('<!--', cursor)) {
                // Comment: kept raw, never scanned for braces.
                const close = source.indexOf('-->', cursor)
                cursor = close === -1 ? length : close + 3
            } else if (/^<script[\s>]/.test(source.slice(cursor, cursor + 8))) {
                readRawBodyElement('script', '</script>')
            } else if (/^<style[\s>]/.test(source.slice(cursor, cursor + 7))) {
                readRawBodyElement('style', '</style>')
            } else if (char === '<') {
                // Any other tag: enter tag state; the `<` stays raw.
                state = 'tag'
                cursor += 1
            } else if (char === '{') {
                readExpression()
            } else {
                cursor += 1
            }
        } else if (char === '"' || char === "'") {
            // Quoted attribute value: kept raw, braces inside are literal.
            const quote = char
            cursor += 1
            while (cursor < length && source.charAt(cursor) !== quote) {
                cursor += 1
            }
            cursor += 1
        } else if (char === '{') {
            readExpression()
        } else if (char === '>') {
            state = 'text'
            cursor += 1
        } else {
            cursor += 1
        }
    }
    flushRaw(length)
    return segments
}
