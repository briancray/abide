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
// A cell shape. `simple` is one slot in an otherwise empty `<td>` — the friendliest case a marker
// scheme can be given, and the one that flatters it. `dense` is what a table an app writes looks
// like: several slots in one cell with static text between them, an attribute driven by a value,
// and a nested element. The static text BETWEEN slots is the part that matters — it is what makes
// a closing marker load-bearing, because adjacent text nodes merge.
export type Shape = 'simple' | 'dense'

export function grid(
    rows: number,
    columns: number,
    variant: Variant,
    shape: Shape = 'simple',
): Grid {
    const perCell = shape === 'dense' ? 3 : 1
    let markup = '<table id="g"><tbody>'
    let at = 0
    for (let row = 0; row < rows; row += 1) {
        markup += '<tr>'
        for (let column = 0; column < columns; column += 1) {
            if (shape === 'simple') {
                markup += `<td>${open(at, variant)}${at}${close(variant)}</td>`
                at += 1
                continue
            }
            // THREE SLOTS AND STATIC TEXT BETWEEN THEM. `no-markers` can still address these
            // structurally — the positions are fixed — but only because every slot here is
            // separated by an element or is an element's sole child. A slot with static text on
            // BOTH sides cannot be, and that is the case the closing marker exists for.
            markup +=
                `<td class="c${at % 4}">` +
                `<b>${open(at, variant)}${at}${close(variant)}</b>` +
                ` of ` +
                `<i>${open(at + 1, variant)}${(at + 1) * 7}${close(variant)}</i>` +
                `<span title="t${at}">${open(at + 2, variant)}${((at + 2) % 9) + 1}${close(variant)}</span>` +
                `</td>`
            at += 3
        }
        markup += '</tr>'
    }
    markup += '</tbody></table>'
    return {
        markup,
        script: mount(variant, shape),
        cells: rows * columns * perCell,
    }
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
function mount(variant: Variant, shape: Shape): string {
    if (variant === 'no-markers') {
        // NO MARKERS AT ALL. The slots are at positions a compiled template knows, so the client
        // walks the tree it already has. Nothing is added to the document, which is also the only
        // scheme that changes no CSS match and no DOM query.
        const perCell =
            shape === 'simple'
                ? 'found.push(td.firstChild)'
                : 'found.push(td.childNodes[0].firstChild, td.childNodes[2].firstChild, td.childNodes[3].firstChild)'
        return `
const found = []
const rows = document.querySelector('#g').firstChild.childNodes
for (let r = 0; r < rows.length; r += 1) {
    const tds = rows[r].childNodes
    for (let c = 0; c < tds.length; c += 1) {
        const td = tds[c]
        ${perCell}
    }
}
globalThis.__SLOTS__ = found
`
    }
    // One or two markers: the walk is over COMMENTS and the number is read off the marker.
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
