// 39.11 — A HEAD CONTRIBUTION'S MERGE KEY, or `undefined` where it has none. ONE GRAMMAR, because
// two lanes decide by it and they have to agree about which contribution replaces which: the
// COMPILER keys a `<head>` child at build time to apply 39.12 within a file, and the CLIENT keys
// the standing document head against an incoming page's on a navigation (39.6). A second spelling
// is a navigation appending a duplicate `<title>` where the server replaced one — silent, and
// visible only in a browser.
//
// THE TAG IS LOWERCASE and the attribute lookup is the caller's, which is the only thing the two
// lanes genuinely differ on: the compiler reads a static attribute off a template node and has no
// value for an expression, the client reads a resolved one off an element.
export function headKeyOf(
    lowerTag: string,
    attribute: (name: string) => string | undefined,
): string | undefined {
    if (lowerTag === 'title' || lowerTag === 'base') return lowerTag
    if (lowerTag === 'meta') {
        const named = attribute('name') ?? attribute('property')
        return named === undefined ? undefined : `meta ${named}`
    }
    if (lowerTag !== 'link') return undefined
    const rel = attribute('rel')
    if (rel === undefined) return undefined
    // An ABSENT `href` is part of the key rather than a hole in it — two `<link rel="canonical">`
    // share one — so the trailing space stays whether or not there is an href to put after it.
    return `link ${rel} ${attribute('href') ?? ''}`
}
