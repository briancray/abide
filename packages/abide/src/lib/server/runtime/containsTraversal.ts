/*
Inspects the raw request URL's PATH portion (not the parsed pathname) for
path-traversal patterns. The WHATWG URL parser decodes `%2E%2E` to `..` and
then collapses dot-segments out of the pathname during normalization, so by
the time `url.pathname` is observable any encoded traversal has been masked.
The remaining literal `..` check guards against any future URL-parser quirk
that lets a normalised path through.

Only the path is scanned — an encoded slash or backslash in a QUERY value
(`/logo.png?from=%2Fblog`) is legitimate and must not 404 a real asset.

Hot path early-out: if none of the suspect substrings appear in the raw
path we never lowercase it nor walk segments.
*/
export function containsTraversal(rawUrl: string): boolean {
    const rawPath = rawPathPortion(rawUrl)
    if (rawPath.includes('\\')) {
        return true
    }
    if (rawPath.includes('..') && rawPath.split('/').some((segment) => segment === '..')) {
        return true
    }
    if (rawPath.indexOf('%') === -1) {
        return false
    }
    const lower = rawPath.toLowerCase()
    return lower.includes('%2e%2e') || lower.includes('%2f') || lower.includes('%5c')
}

/* The raw path of an absolute request URL: first `/` after the authority up
   to the query. Requests never carry a fragment, so `?` is the only cutoff. */
function rawPathPortion(rawUrl: string): string {
    const queryStart = rawUrl.indexOf('?')
    const pathEnd = queryStart === -1 ? rawUrl.length : queryStart
    const schemeEnd = rawUrl.indexOf('://')
    const pathStart = rawUrl.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 3)
    if (pathStart === -1 || pathStart >= pathEnd) {
        return ''
    }
    return rawUrl.slice(pathStart, pathEnd)
}
