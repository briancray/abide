// How many leading entries two lists share. The longest-common-prefix loop, owned once.
//
// The layout-graft rule is expressed with it on BOTH sides — the server's `sharedLayoutDepth` and the
// client's nav header builder — and the two were character-identical loops, the client's carrying a
// comment calling itself "the client mirror of the server's `sharedLayoutDepth`". A comment naming a
// duplicate is a duplicate, and this one decides how much of a live page survives a soft nav.
export function commonPrefixLength(a: readonly string[], b: readonly string[]): number {
    let length = 0
    while (length < a.length && length < b.length && a[length] === b[length]) length++
    return length
}
