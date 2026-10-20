// 32.20 — a URL-typed attribute is scheme-checked and a scheme outside the safe set is DROPPED.
// In #shared beside the escaping because the check has to happen where the value does: a literal
// `href` is checked at compile time, and an INTERPOLATION cannot be — its value arrives at run
// time, which is also the only place untrusted data ever arrives. Checking only the literal read
// as compliance and guarded nothing.
//
// The warning on `abide:render` the clause also asks for is `attributeText`'s, which knows the
// attribute's name.
import { textOf } from './Raw.ts'

const SAFE_SCHEMES = new Set([
    'http:',
    'https:',
    'mailto:',
    'tel:',
    'blob:',
    'data:',
])

/** A URL attribute's text, or `''` where its scheme is outside the safe set. */
export function safeUrl(value: unknown): string {
    // A `Raw` reaches here from `<a href={raw(u)}>`, and the brand says "already markup", which is
    // no claim at all about the scheme. The html is the text to check.
    const text = textOf(value)
    const scheme = schemeOf(text)
    if (scheme === '') return text
    return SAFE_SCHEMES.has(scheme) ? text : ''
}

// The scheme A BROWSER will read, lowercased, or '' where the value carries none.
//
// BUILT RATHER THAN MATCHED, because the bytes are not the URL. Before a browser looks for a
// scheme it trims leading C0 controls and spaces and removes every TAB, LF and CR from what is
// left, so `" javascript:alert(1)"` and `"java\tscript:alert(1)"` are both `javascript:` and both
// navigate — a regex over the raw value called all three of them relative and safe.
//
// An `&#106;avascript:` entity reaches the same place by a third road and is stopped one layer up
// rather than here: `escapeAttribute` encodes the `&`, so the entity never forms. 32.27 narrowed
// that rewrite off every OTHER static attribute — static text is the author's own markup — and
// 32.28 is why this set keeps it: here the encoding is not a formatting rule, it is the whole of
// what stops the entity, and it is the only guard the scheme check has behind it.
//
// The scan stops at the first character no scheme can hold, so a relative reference — the common
// case — costs one character. The scheme is sliced once at the colon rather than grown per character.
function schemeOf(text: string): string {
    let at = 0
    while (at < text.length && text.charCodeAt(at) <= 0x20) at += 1
    const start = at
    let length = 0
    let stripped = false
    for (; at < text.length; at += 1) {
        const code = text.charCodeAt(at)
        if (code === 9 || code === 10 || code === 13) {
            stripped = true
            continue
        }
        if (code === 58) {
            if (length === 0) return ''
            const scheme = text.slice(start, at)
            return `${(stripped ? scheme.replace(/[\t\n\r]/g, '') : scheme).toLowerCase()}:`
        }
        const lower = code >= 65 && code <= 90 ? code + 32 : code
        const alpha = lower >= 97 && lower <= 122
        const allowed =
            alpha ||
            (length > 0 &&
                ((code >= 48 && code <= 57) ||
                    code === 43 ||
                    code === 45 ||
                    code === 46))
        if (!allowed) return ''
        length += 1
    }
    return ''
}
