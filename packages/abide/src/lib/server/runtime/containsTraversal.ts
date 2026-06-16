/*
Inspects the raw request URL (not the parsed pathname) for path-traversal
patterns. The WHATWG URL parser decodes `%2E%2E` to `..` and then collapses
dot-segments out of the pathname during normalization, so by the time
`url.pathname` is observable any encoded traversal has been masked. The
remaining literal `..` check guards against any future URL-parser quirk
that lets a normalised path through.

Hot path early-out: if none of the suspect substrings appear in the raw
URL we never lowercase the whole string nor walk segments.
*/
export function containsTraversal(rawUrl: string): boolean {
    if (rawUrl.includes('\\')) {
        return true
    }
    if (rawUrl.includes('..') && segmentContainsDotDot(rawUrl)) {
        return true
    }
    if (rawUrl.indexOf('%') === -1) {
        return false
    }
    const lower = rawUrl.toLowerCase()
    return lower.includes('%2e%2e') || lower.includes('%2f') || lower.includes('%5c')
}

function segmentContainsDotDot(rawUrl: string): boolean {
    const queryStart = rawUrl.indexOf('?')
    const pathEnd = queryStart === -1 ? rawUrl.length : queryStart
    const pathStart = rawUrl.indexOf('/', rawUrl.indexOf('://') + 3)
    if (pathStart === -1 || pathStart >= pathEnd) {
        return false
    }
    return rawUrl
        .slice(pathStart, pathEnd)
        .split('/')
        .some((segment) => segment === '..')
}
