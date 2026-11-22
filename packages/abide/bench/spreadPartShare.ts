// WHAT A ROW PAYS TO TAKE A BEHAVIOR AS A PART RATHER THAN AN ADAPTOR. `bind:element={fn}` hands
// the node over once; `{...part()}` is a spread, kept written by a watch (32.11), with its element
// binding handed over beside it (32.99). This prices the difference at the n a row cost could cross
// a frame, so the library shipping every behavior as a part is a stated cost rather than an assumed
// one.
//
// MEASURED at 1000 rows, twice: plain 2.7 µs a row, adaptor 2.9, a part carrying a `data-` name 4.1.
// With BOTH spread watches swapped for a one-time write the part was still 3.6 — so a fast path
// skipping the watches for a part that reads nothing reactive is capped at ~0.5 ms per 1000 rows,
// under perception, and was not built. The rest is the part itself: a record made per row and its
// keys walked. The op column is frame-quantized at this n — two arms swapped between 17 and 32 ms
// across runs with their reconcile unchanged — so read the reconcile, not the op.
//
// `bun run bench:spread-part [rows]`

import { priceRowArms, replacePage } from './priceRowArms.ts'

const ROWS = Number(process.argv[2] ?? '1000')

// One fresh part per row, as `{...copy()}` makes one: the shape a parts function hands back.
const SCRIPT = `
const mark = (element: Element) => { element.toggleAttribute('data-bound', true) }
const named = () => ({ 'data-mark': 'mark', 'bind:element': mark })
const bare = () => ({ 'bind:element': mark })`

const ROW =
    '<li aria-selected={selected === row.id}><span>{row.label}</span></li>'

await priceRowArms(
    ROWS,
    {
        'plain row': { source: replacePage(ROWS, ROW, SCRIPT) },
        adaptor: {
            source: replacePage(
                ROWS,
                ROW.replace(
                    '<li ',
                    '<li data-mark="mark" bind:element={mark} ',
                ),
                SCRIPT,
            ),
        },
        'part, named': {
            source: replacePage(
                ROWS,
                ROW.replace('<li ', '<li {...named()} '),
                SCRIPT,
            ),
        },
        'part, binding only': {
            source: replacePage(
                ROWS,
                ROW.replace('<li ', '<li {...bare()} '),
                SCRIPT,
            ),
        },
    },
    (script) => (script.includes('bindSpread(') ? 'spreads ' : '        '),
)
