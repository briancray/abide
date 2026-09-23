import { parseMarkup } from './parseMarkup.ts'

// WHAT THE PARSER MAKES OF A STATIC STRING, for a row the browser BUILDS rather than parses. The
// server writes an author's static text and static attribute values as their own bytes, and the
// browser DECODES them — `AT&amp;T` is `AT&T` on the page. A built row writes through `data` and
// `setAttribute`, which decode nothing, so the build has to hand over what the parser would have
// made — written straight through, every grown row shows `AT&amp;T` where the server's shows `AT&T`.
//
// THE PARSER IS ASKED, not a table. HTML's named references are two thousand entries and the
// attribute and text rules differ at the edges; the parser that read the server's markup is the
// only answer that cannot disagree with it. Asked ONCE A STRING and kept: only a static string
// with an `&` in it comes here, the compiler knows every one, and a row reads it back from a map:
// the parser invoked once a string, never once a row.
const TEXTS = new Map<string, string>()
const ATTRIBUTES = new Map<string, string>()

export function decodedText(near: Node, markup: string): string {
    let text = TEXTS.get(markup)
    if (text === undefined) {
        text = parseMarkup(near, markup).textContent ?? ''
        TEXTS.set(markup, text)
    }
    return text
}

// `bytes` is what the server writes between an attribute's quotes (`staticAttributeBytes`), so the
// value is decoded by the ATTRIBUTE rule, which is not the text rule for a `&` with no `;`.
export function decodedAttribute(near: Node, bytes: string): string {
    let value = ATTRIBUTES.get(bytes)
    if (value === undefined) {
        const element = parseMarkup(near, `<i a="${bytes}"></i>`)
            .firstChild as Element
        value = element.getAttribute('a') ?? ''
        ATTRIBUTES.set(bytes, value)
    }
    return value
}
