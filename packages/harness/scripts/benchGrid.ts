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

// THE TWO COSTS IN ONE CURRENCY. Bytes are only comparable to a walk once they are time, and
// they become time at a bandwidth — so the bandwidth is stated rather than assumed. These are
// throughput figures for a warm connection, not first-byte latency, which neither scheme changes.
const LINKS: [string, number][] = [
    ['slow 4G, 1.5 Mbps', 1.5e6 / 8],
    ['median mobile, 5 Mbps', 5e6 / 8],
    ['home broadband, 25 Mbps', 25e6 / 8],
]

console.log('\nBYTES AS TIME — the 15,000-slot page, markers against none\n')
{
    const withMarkers = Bun.gzipSync(
        new TextEncoder().encode(grid(100, 50, 'two-markers', 'dense').markup),
    ).length
    const without = Bun.gzipSync(
        new TextEncoder().encode(grid(100, 50, 'no-markers', 'dense').markup),
    ).length
    const extra = withMarkers - without
    console.log(
        `  markers add ${(extra / 1024).toFixed(1)} KB gzipped (${(without / 1024).toFixed(1)} -> ${(withMarkers / 1024).toFixed(1)} KB)`,
    )
    for (const [name, bytesPerSecond] of LINKS)
        console.log(
            `    ${name.padEnd(24)} ${((extra / bytesPerSecond) * 1000).toFixed(0)} ms of transfer`,
        )
    console.log('')
    console.log(
        '  Against that, the WALK: hoisting the shared prefix makes a structural walk flat in',
    )
    console.log(
        '  depth and 0.87-1.35x a marker walk — call it a wash, and under 0.2 ms either way at',
    )
    console.log(
        '  15,000 bindings. `depth.spec.ts` has the table. So the byte column decides, and it',
    )
    console.log('  decides by one to two orders of magnitude.\n')
}

console.log('WHAT THIS DECIDES, and it is not what it looks like.\n')
console.log(
    '  ONE MARKER INSTEAD OF TWO SAVES ALMOST NOTHING: ~2% gzip. The incompressible part is',
)
console.log(
    '  the distinct numbers a0..aN, not the <!-- around them. "Fewer markers" is not the lever.\n',
)
console.log(
    '  HYDRATION SPEED DOES NOT DECIDE IT EITHER. The walk is 15-39% of hydration once',
)
console.log(
    '  bindings do ordinary work, so eliding every marker has a ceiling of ~19% of an',
)
console.log(
    '  operation that would not cross a frame until ~150,000 slots. And a HOISTED structural',
)
console.log(
    '  walk is level with a marker walk anyway, so there is no speed to trade at all.\n',
)
console.log(
    '  A NAIVE STRUCTURAL WALK DOES LOSE, and by a lot: O(bindings x depth), measured at 13x',
)
console.log(
    '  a marker walk on a tree 32 deep. That is an emitted-code problem, not a scheme problem',
)
console.log(
    '  — the compiler holds every path, so the shared prefix is walked once and the cost goes',
)
console.log('  flat. It is the thing to check if the walk ever regresses.\n')
console.log(
    '  SO THE ANSWER IS BYTES AND OBSERVABILITY. Markers double a slot-dense page gzipped,',
)
console.log(
    '  which is 78 ms of transfer on a median mobile link against a walk difference of under',
)
console.log(
    '  0.1 ms. And a compiler may not invent structure an author CSS or queries can see —',
)
console.log(
    '  which is not a budget at all. `invariance.spec.ts` holds that at zero differences,',
)
console.log(
    '  including descendant, :has and universal matching, which a WRAPPER would break and a',
)
console.log('  comment would not.\n')
console.log(
    '  WHERE A MARKER STILL EARNS ITS BYTES: a region whose shape depends on a value shifts',
)
console.log(
    "  its siblings' child indices, so 32.13 and 32.14 need an ANCHOR the document keeps",
)
console.log(
    '  whether the region rendered or not. A comment is the right anchor — selector-safe,',
)
console.log('  and the only thing on this page that is.')
