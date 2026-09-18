// WHAT A MARKER COSTS ON A PAGE BIG ENOUGH TO SHOW IT. Bytes and node counts only — this file has
// no clock in it, because a marker's cost in an emulated DOM is a fact about the emulator. The
// clock lives in the browser spec beside it.
//
// CLAUDE.md already records ONE marker-elision change that was tried and dropped: 998 fewer
// records measured at +0.053 ms and then -0.033 ms, under the noise floor. That was about MOVING
// markers in a reorder. This is a different question — what they cost to ship and to walk at
// hydration — and it has to answer in something other than a count or it goes the same way.

import { grid, type Variant } from './GRID.ts'

const VARIANTS: Variant[] = ['two-markers', 'one-marker', 'no-markers']
const SHAPES: [number, number][] = [
    [10, 10],
    [50, 20],
    [100, 50],
]

console.log('BYTES AND NODES — what the document carries\n')
for (const [rows, columns] of SHAPES) {
    const cells = rows * columns
    console.log(`  ${rows}x${columns} = ${cells} cells`)
    const base = grid(rows, columns, 'no-markers')
    for (const variant of VARIANTS) {
        const built = grid(rows, columns, variant)
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

console.log('WHAT THIS DECIDES, and it is not what it looks like.\n')
console.log(
    '  ONE MARKER INSTEAD OF TWO SAVES ALMOST NOTHING: 2.3% gzip at 1000 cells. The',
)
console.log(
    '  incompressible part is the distinct numbers `a0`..`a999`, not the `<!--` around',
)
console.log(
    '  them, so halving the markers halves almost none of the bytes. "Fewer markers" is',
)
console.log('  not the lever; "no markers" is.\n')
console.log(
    '  THE HYDRATION WALK IS NOT THE REASON EITHER. Markers make it 2.5-2.7x (chromium)',
)
console.log(
    '  and 3.3-4.5x (webkit), and all of it is invisible: 0.44 ms for 5000 cells, which',
)
console.log(
    '  would not cross a frame until ~180,000 cells. `bun run e2e:harness` has the table.\n',
)
console.log(
    '  WHAT IS LEFT IS BYTES, and they are worth acting on: a slot-dense page is about',
)
console.log(
    '  TWICE the size gzipped. At 5000 cells that is +12 KB on the wire — on a 1 Mbps',
)
console.log(
    '  link, roughly 100 ms before anything renders, which is an interaction budget.',
)
console.log(
    '  That is the one column here that crosses perception, and it crosses it on the',
)
console.log('  network rather than in the walk.\n')
console.log(
    '  THE SHAPE THAT FOLLOWS: a region whose structure is STATIC can be walked',
)
console.log(
    '  structurally and needs no markers at all — a compiled template knows where its',
)
console.log(
    '  slots are. Markers then stop being a per-slot mechanism and become a per-REGION',
)
console.log(
    '  one, needed only where the shape depends on a value (32.13, 32.14, 32.16). Not',
)
console.log('  built; this is the measurement that says to build it.')
