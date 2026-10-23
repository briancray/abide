const XLINK = 'http://www.w3.org/1999/xlink'
const XML = 'http://www.w3.org/XML/1998/namespace'
const XMLNS = 'http://www.w3.org/2000/xmlns/'

/**
 * The attributes the HTML parser puts in a namespace on an SVG or MathML element — its "adjust
 * foreign attributes" table — each to that namespace. Every other attribute it writes has none.
 *
 * A leaf, because the compiler reads it to know which built attribute needs the client's
 * `addAttribute`, and the client reads it to write one.
 */
export const FOREIGN_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
    ['xlink:actuate', XLINK],
    ['xlink:arcrole', XLINK],
    ['xlink:href', XLINK],
    ['xlink:role', XLINK],
    ['xlink:show', XLINK],
    ['xlink:title', XLINK],
    ['xlink:type', XLINK],
    ['xml:lang', XML],
    ['xml:space', XML],
    ['xmlns', XMLNS],
    ['xmlns:xlink', XMLNS],
])
