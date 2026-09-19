// 32.1 — `{expr}` renders escaped. In #shared because BOTH sides parse markup now: the server
// writes the document, and a client swapping a `{#if}` branch re-renders that region's markup.
// A text run is still written through `data`, which is not a parse and needs none of this —
// `escapeless` in #ui is that path, and the two sitting apart is what keeps them from being
// confused for one another.

import { Raw, textOf } from './Raw.ts'

// The common slot holds nothing to escape, so the scan is the fast path and the rewrite is
// the fallback: a clean string is returned as it arrived, with no allocation.
//
// THE DETECTION IS THE ENGINE'S, not a `charCodeAt` loop. The hand-written scan is one JS
// iteration per character where this is vectorised, and it lost on the case it was written for:
// 5x on a clean 74-character slot and 14x on a clean 320-character one, over two runs that did
// not swap places. The share is named — `escapeText` is 74-86% of a 500-row x 4-slot markup
// build, and the whole build moves 1.7x.
const SPECIAL = /[&<>]/

export function escapeText(value: unknown): string {
    // 32.28 — a branded raw value renders unescaped, and the brand is read FIRST: `String(value)`
    // below turns a `Raw` into its html and the scan then escapes exactly the markup the brand
    // was put on to keep. What the check costs is in `Raw.ts`.
    if (value instanceof Raw) return value.html
    return escapeMarkup(value == null ? '' : String(value))
}

// The rewrite alone, with no brand read — the one both slot and attribute escaping run.
function escapeMarkup(text: string): string {
    const at = text.search(SPECIAL)
    if (at === -1) return text

    // SLICED, NOT APPENDED PER CHARACTER. The tail after an escape is copied in one piece, so the
    // concatenation count is the number of ESCAPES rather than the length — 4x on a 2 KB string
    // carrying one, and the difference grows with what follows it.
    let out = text.slice(0, at)
    let cut = at
    for (let i = at; i < text.length; i += 1) {
        const code = text.charCodeAt(i)
        if (code !== 38 && code !== 60 && code !== 62) continue
        if (i > cut) out += text.slice(cut, i)
        out += code === 38 ? '&amp;' : code === 60 ? '&lt;' : '&gt;'
        cut = i + 1
    }
    return cut < text.length ? out + text.slice(cut) : out
}

// The same rewrite for an attribute value, plus the quote that would end it. A separate function
// rather than a flag: the flag would be read on every slot to answer a question the call site
// already knows.
//
// 32.28 IS A SLOT'S CLAUSE, NOT AN ATTRIBUTE'S. Delegating straight to `escapeText` handed the
// brand this path too, so `<iframe srcdoc={raw(html)}>` copied markup into a value a browser
// parses as a document, and `title={raw('AT&T')}` lost the `&` encoding — which is the only thing
// standing behind `safeUrl`'s scheme check, per 32.30. A `Raw` here is escaped like the string it
// holds, which is why this runs the rewrite rather than `escapeText`.
export function escapeAttribute(value: unknown): string {
    const text = escapeMarkup(textOf(value))
    return text.includes('"') ? text.replaceAll('"', '&quot;') : text
}

// 32.11 — A `style:prop` SETS ONE PROPERTY, and `;` is the one character that lets a value say
// otherwise. The attribute escaping cannot see it, because `;` is ordinary in every other
// attribute: `style:color={v}` with `v` off the wire wrote `color: red; position: fixed; top: 0;
// …` — seven declarations from the slot that declares one, and an overlay over the page. Cut at
// the separator rather than encoded, because there is no encoding of `;` a CSS parser reads as a
// literal semicolon inside a value.
export function escapeStyleValue(value: unknown): string {
    const text = escapeAttribute(value)
    const end = text.indexOf(';')
    return end === -1 ? text : text.slice(0, end)
}
