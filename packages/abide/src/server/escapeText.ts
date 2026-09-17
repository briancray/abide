// 32.1 — `{expr}` renders escaped. Server-side only by design: the client sets text through
// `node.data`, which is not a parse, so it needs none of this. That is why it is here rather
// than in #shared.

// The common slot holds nothing to escape, so the scan is the fast path and the rewrite is
// the fallback: a clean string is returned as it arrived, with no allocation.
export function escapeText(value: unknown): string {
    const text = value == null ? '' : String(value)
    let at = -1
    for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i)
        if (code === 38 || code === 60 || code === 62) {
            at = i
            break
        }
    }
    if (at === -1) return text

    let out = text.slice(0, at)
    for (let i = at; i < text.length; i += 1) {
        const code = text.charCodeAt(i)
        if (code === 38) out += '&amp;'
        else if (code === 60) out += '&lt;'
        else if (code === 62) out += '&gt;'
        else out += text[i]
    }
    return out
}

// The same rewrite for an attribute value, plus the quote that would end it. A separate function
// rather than a flag: the flag would be read on every slot to answer a question the call site
// already knows.
export function escapeAttribute(value: unknown): string {
    const text = escapeText(value)
    return text.includes('"') ? text.replaceAll('"', '&quot;') : text
}
