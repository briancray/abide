// THE GRID PAGE, and the marker variants it is measured in. A leaf in the sense that matters —
// both the bun-side count and the browser-side clock build the same page from here, so a
// difference between the two substrates is the substrate and not the page.
//
// WHY A GRID. Hydration cost is per SLOT, and a page with three slots cannot tell any scheme from
// any other. A grid is the shape where the count is large, regular, and shaped like something an
// app really renders — and where "the slot is an element's only child" is true of every cell,
// which is the case a marker might be elidable in.

export type Variant = 'two-markers' | 'one-marker' | 'no-markers'

export type Grid = { markup: string; script: string; cells: number }

// `<td>{value}</td>` — the slot is the element's ONLY child, so nothing can merge with it.
export function grid(rows: number, columns: number, variant: Variant): Grid {
    const cells = rows * columns
    let markup = '<table id="g"><tbody>'
    let at = 0
    for (let row = 0; row < rows; row += 1) {
        markup += '<tr>'
        for (let column = 0; column < columns; column += 1) {
            markup += `<td${variant === 'no-markers' ? '' : ''}>${open(at, variant)}${at}${close(variant)}</td>`
            at += 1
        }
        markup += '</tr>'
    }
    markup += '</tbody></table>'
    return { markup, script: mount(cells, variant), cells }
}

function open(at: number, variant: Variant): string {
    if (variant === 'no-markers') return ''
    return `<!--a${at}-->`
}

function close(variant: Variant): string {
    return variant === 'two-markers' ? '<!--/a-->' : ''
}

// The client half of each variant, hand-written. These are ARMS, not emitted code: the point is
// to price the scheme before building it, which is the whole of "write the vanilla form first".
function mount(cells: number, variant: Variant): string {
    if (variant === 'no-markers')
        // NO MARKERS AT ALL. The cells are at a known structural position, so the client walks
        // the tree it already has: every `<td>` in order, and the slot is its first child. Exact
        // for a region whose shape is static, which a compiled template's is.
        return `
const found = []
const rows = document.querySelector('#g').firstChild.childNodes
for (let r = 0; r < rows.length; r += 1) {
    const tds = rows[r].childNodes
    for (let c = 0; c < tds.length; c += 1) found.push(tds[c].firstChild)
}
globalThis.__SLOTS__ = found
`
    // One or two markers: the walk is over COMMENTS, and the number is read off the marker.
    return `
const found = []
const walker = document.createTreeWalker(document.querySelector('#g'), NodeFilter.SHOW_COMMENT)
while (true) {
    const comment = walker.nextNode()
    if (comment === null) break
    const data = comment.data
    if (data.charCodeAt(0) !== 97 || data.length === 1) continue
    found[Number(data.slice(1))] = comment.nextSibling
}
globalThis.__SLOTS__ = found
`
}
