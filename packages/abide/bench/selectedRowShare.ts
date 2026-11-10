// THE SELECTED ROW — the list shape real apps write most: a keyed list whose row reads PAGE state in
// an attribute (`aria-selected={selected === row.id}`). Every arm's row is BUILT; what the selected
// row adds is a MOUNT — a scope a row, and a watch on page state in it — where a row reading only its
// item mounts nothing. Eight of the corpus's twenty rows are this shape, and every one of them is a
// tab bar of three to five buttons, where the difference cannot be seen. This prices it at the n
// where it could be: a list big enough to cross a frame.
//
// `bun packages/abide/bench/selectedRowShare.ts [rows]` — reports how the compiler made and mounted
// each arm's row, read off the emitted module, beside what it cost.

import { priceRowArms, replacePage } from './priceRowArms.ts'

const ROWS = Number(process.argv[2] ?? '1000')
const page = (row: string) => ({ source: replacePage(ROWS, row) })

await priceRowArms(
    ROWS,
    {
        'selected row': page(
            '<li aria-selected={selected === row.id}><span>{row.label}</span></li>',
        ),
        // THE SAME ROW WITHOUT THE PAGE READ — what a row costs when it is built and binds nothing
        // beyond its item. The floor the selected row can reach, not a target it must.
        'plain row': page('<li><span>{row.label}</span></li>'),
        // A BLOCK INSIDE THE ROW: the row is built with an empty anchor pair, and the row's mount
        // gives it an `ArmRegion` that fills it on the first run — by BUILDING its arm, once a row.
        'nested block': page(
            '<li>{#if row.id >= 0}<b>on</b>{/if}<span>{row.label}</span></li>',
        ),
        // THE MACHINERY WITHOUT THE NODES: an arm with nothing in it builds none — the region, its
        // watch and the row's scope are all still made, and the arm itself mounts nothing.
        'empty block': page(
            '<li>{#if row.id >= 0}{/if}<span>{row.label}</span></li>',
        ),
        // The same nodes with no block around the `<b>`: what the row costs when nothing is filled.
        'same, no block': page('<li><b>on</b><span>{row.label}</span></li>'),
    },
    // BUILT where the row's `make` creates its `<li>`, PARSED where it hands markup to its parent;
    // every build also carries a `markupNodes` for a `Raw` value, so only the `__parent` form
    // says parsed. A row that binds nothing beyond its item mounts `EMPTY_SCOPE`.
    (script) =>
        `${(script.includes('createElementNS(__space, "li")')
            ? 'BUILT'
            : script.includes('markupNodes(__parent')
              ? 'PARSED'
              : 'unknown'
        ).padEnd(7)} ${(script.includes('ls0_mount = () => EMPTY_SCOPE')
            ? 'mounts nothing'
            : 'mounts a scope'
        ).padEnd(14)}`,
)
