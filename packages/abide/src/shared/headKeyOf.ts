// 39.11 — A HEAD CONTRIBUTION'S MERGE KEY, or `undefined` where it has none. ONE GRAMMAR, because
// two lanes decide by it and they have to agree about which contribution replaces which: the
// COMPILER keys a `<head>` child at build time to apply 39.12 within a file, and the CLIENT keys
// the standing document head against an incoming page's on a navigation (39.6). A second spelling
// is a navigation appending a duplicate `<title>` where the server replaced one — silent, and
// visible only in a browser.
//
// THE TAG IS LOWERCASE and the attribute lookup is the caller's, which is the only thing the two
// lanes genuinely differ on: the compiler reads a static attribute off a template node, the client
// a resolved one off an element. The lookup answers in `getAttribute`'s terms — `null` is ABSENT —
// and `undefined` is PRESENT BUT UNKNOWN to this lane (an expression, at build time). The two are
// different answers: an absent `href` is part of a `<link>`'s key, and an unknown `name` outranks
// whatever `property` says, so either leaves the contribution with no key here.
export function headKeyOf(
    lowerTag: string,
    attribute: (name: string) => string | null | undefined,
): string | undefined {
    if (lowerTag === 'title' || lowerTag === 'base') return lowerTag
    if (lowerTag === 'meta') {
        const named = attribute('name')
        const key = named === null ? attribute('property') : named
        return key == null ? undefined : `meta ${key}`
    }
    if (lowerTag !== 'link') return undefined
    const rel = attribute('rel')
    const href = attribute('href')
    if (rel == null || href === undefined) return undefined
    // An ABSENT `href` is part of the key rather than a hole in it — two `<link rel="canonical">`
    // share one — so the trailing space stays whether or not there is an href to put after it.
    return `link ${rel} ${href ?? ''}`
}
