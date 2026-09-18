// WHAT A MARKER COSTS ON A PAGE BIG ENOUGH TO SHOW IT. Bytes and node counts only — this file has
// no clock in it, because a marker's cost in an emulated DOM is a fact about the emulator. The
// clock lives in the browser spec beside it.
//
// CLAUDE.md already records ONE marker-elision change that was tried and dropped: 998 fewer
// records measured at +0.053 ms and then -0.033 ms, under the noise floor. That was about MOVING
// markers in a reorder. This is a different question — what they cost to ship and to walk at
// hydration — and it has to answer in something other than a count or it goes the same way.

import { grid, type Shape, type Variant } from './GRID.ts'

const VARIANTS: Variant[] = ['two-markers', 'one-marker', 'no-markers']
const SHAPES: [number, number][] = [
    [10, 10],
    [50, 20],
    [100, 50],
]

console.log('BYTES AND NODES — what the document carries\n')
for (const shape of ['simple', 'dense'] as Shape[]) {
    for (const [rows, columns] of SHAPES) {
        const base = grid(rows, columns, 'no-markers', shape)
        console.log(`  ${shape} ${rows}x${columns} = ${base.cells} slots`)
        for (const variant of VARIANTS) {
            const built = grid(rows, columns, variant, shape)
            const raw = new TextEncoder().encode(built.markup)
            const comments = (built.markup.match(/<!--/g) ?? []).length
            // WHAT SHIPS IS COMPRESSED, and a marker is the most compressible thing on the page: the
            // same token, thousands of times. The raw column overstates the cost by a lot, and
            // quoting it would be quoting the worst case as if it were the bill.
            const zipped = Bun.gzipSync(raw).length
            const zippedBase = Bun.gzipSync(
                new TextEncoder().encode(base.markup),
            ).length
            console.log(
                `    ${variant.padEnd(12)} raw ${String(raw.length).padStart(7)}  gzip ${String(zipped).padStart(6)}  ${String(comments).padStart(6)} comments  gzip +${String(zipped - zippedBase).padStart(5)} over none (${((zipped / zippedBase - 1) * 100).toFixed(1)}%)`,
            )
        }
        console.log('')
    }
}

console.log('WHAT THIS DECIDES, and it is not what it looks like.\n')
console.log(
    '  ONE MARKER INSTEAD OF TWO SAVES ALMOST NOTHING: ~2% gzip. The incompressible part is',
)
console.log(
    '  the distinct numbers a0..aN, not the <!-- around them, so halving the markers halves',
)
console.log('  almost none of the bytes. "Fewer markers" is not the lever.\n')
console.log(
    '  HYDRATION SPEED IS NOT THE REASON EITHER, and the share says so. With bindings doing',
)
console.log(
    '  ordinary work the WALK is 15-39% of hydration, so eliding every marker has a ceiling',
)
console.log(
    '  of ~19% — of an operation that is 4.2 ms at 15,000 slots and would not cross a frame',
)
console.log(
    '  until ~150,000. CLAUDE.md already records one marker-elision change dropped for this',
)
console.log(
    '  exact reason: 998 fewer records, +0.053 ms then -0.033. A count is not a cost.\n',
)
console.log('  TWO REASONS SURVIVE, and the second one settles it.\n')
console.log(
    '  BYTES. A slot-dense page is about twice the size gzipped: +49 KB at 15,000 slots,',
)
console.log(
    '  which on a 1 Mbps link is ~400 ms before anything renders. That is an interaction',
)
console.log('  budget, spent on the network rather than in the walk.\n')
console.log(
    '  OBSERVABILITY, which is a CORRECTNESS constraint and not a budget at all. A compiler',
)
console.log(
    '  may not invent structure that changes what CSS matches or what a DOM query returns.',
)
console.log(
    '  `invariance.spec.ts` measures four places the current scheme does: `[data-a]` is',
)
console.log(
    '  matched by an attribute selector in the document AS SERVED; `firstChild` is a Comment',
)
console.log(
    '  where the author wrote a Text; and `childNodes` gains two entries per slot, including',
)
console.log(
    '  in an element the author left empty. CSS structural selectors are all untouched —',
)
console.log(
    '  including `:empty`, which both engines ignore comments for — so a comment is safe for',
)
console.log('  style and unsafe for traversal.\n')
console.log(
    '  THE SHAPE THAT FOLLOWS: markers in fewer PLACES, not fewer markers. A region whose',
)
console.log(
    '  structure is static is walked structurally and adds nothing to the document; markers',
)
console.log(
    '  become a per-REGION mechanism at the boundaries where shape depends on a value',
)
console.log(
    '  (32.13, 32.14, 32.16). The same boundary the slot addressing already draws.',
)
