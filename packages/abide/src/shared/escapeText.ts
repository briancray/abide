// 32.1 — `{expr}` renders escaped. In #shared because BOTH sides parse markup now: the server
// writes the document, and a client swapping a `{#if}` branch re-renders that region's markup.
// A text run is still written through `data`, which is not a parse and needs none of this —
// `escapeless` in #ui is that path, and the two sitting apart is what keeps them from being
// confused for one another.

import { RAW_WRITES, Raw, textOf } from './Raw.ts'

// The common slot holds nothing to escape, so the scan is the fast path and the rewrite is
// the fallback: a clean string is returned as it arrived, with no allocation.
//
// THE DETECTION IS THE ENGINE'S, not a `charCodeAt` loop. The hand-written scan is one JS
// iteration per character where this is vectorised, and it lost on the case it was written for:
// 5x on a clean 74-character slot and 14x on a clean 320-character one, over two runs that did
// not swap places. The share is named — `escapeText` is 74-86% of a 500-row x 4-slot markup
// build, and the whole build moves 1.7x.
const SPECIAL = /[&<>]/

/** A slot value as markup text: escaped, or a `Raw`'s html as it is. */
export function escapeText(value: unknown): string {
    // 32.26 — a branded raw value renders unescaped, and the brand is read FIRST: `String(value)`
    // below turns a `Raw` into its html and the scan then escapes exactly the markup the brand
    // was put on to keep. What the check costs is in `Raw.ts`, and why it is counted is `markupRun`.
    if (value instanceof Raw) {
        RAW_WRITES.count += 1
        return value.html
    }
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

/**
 * A value escaped for a double-quoted attribute, a `Raw` included.
 *
 * The same rewrite as a slot's, plus the quote that would end it. A separate function rather than
 * a flag: the flag would be read on every slot to answer a question the call site already knows.
 *
 * 32.26 IS A SLOT'S CLAUSE, NOT AN ATTRIBUTE'S. Delegating straight to `escapeText` handed the
 * brand this path too, so `<iframe srcdoc={raw(html)}>` copied markup into a value a browser
 * parses as a document, and `title={raw('AT&T')}` lost the `&` encoding — which is the only thing
 * standing behind `safeUrl`'s scheme check, per 32.28. A `Raw` here is escaped like the string it
 * holds, which is why this runs the rewrite rather than `escapeText`.
 */
export function escapeAttribute(value: unknown): string {
    return escapeQuote(escapeMarkup(textOf(value)))
}

/**
 * Text with only its `"` encoded: the one rewrite the author's own attribute text takes.
 *
 * 32.27 — it is markup, so its `&` stays a reference, and only the `"` that would end the
 * attribute is encoded.
 */
export function escapeQuote(text: string): string {
    return text.includes('"') ? text.replaceAll('"', '&quot;') : text
}

/**
 * A `style:prop` value escaped for markup and cut at its first `;`.
 *
 * 32.10 — A `style:prop` SETS ONE PROPERTY, and `;` is the one character that lets a value say
 * otherwise. The attribute escaping cannot see it, because `;` is ordinary in every other
 * attribute: `style:color={v}` with `v` off the wire wrote `color: red; position: fixed; top: 0;
 * …` — seven declarations from the slot that declares one, and an overlay over the page. Cut at
 * the separator rather than encoded, because there is no encoding of `;` a CSS parser reads as a
 * literal semicolon inside a value.
 */
export function escapeStyleValue(value: unknown): string {
    return oneStyleValue(escapeAttribute(value))
}

/**
 * Text up to its first `;`: one style declaration's value, with no escaping.
 *
 * The cut ALONE, with no escaping in front of it, because the client writes a `style:prop` through
 * the CSSOM and that is not a parse (`setStyleProperty`). Lifted out rather than copied: the guard
 * in `escapeStyleValue` and the client's write have to drop at the same character, and a CSSOM
 * that refuses the whole value where the server kept its first declaration is the two disagreeing
 * about what one `style:prop` rendered.
 */
export function oneStyleValue(text: string): string {
    const end = text.indexOf(';')
    return end === -1 ? text : text.slice(0, end)
}
