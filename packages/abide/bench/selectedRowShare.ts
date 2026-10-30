// THE SELECTED ROW — the list shape real apps write most: a keyed list whose row reads PAGE state in
// an attribute (`aria-selected={selected === row.id}`). A row that reads a page-level `Reactive`
// was the one shape construction refused, so every such row was PARSED — `markupNodes`, one
// `innerHTML` a row — where a row reading only its item was BUILT. Eight of the corpus's twenty rows
// are this shape, and every one of them is a tab bar of three to five buttons, where the difference
// cannot be seen. This prices it at the n where it could be: a list big enough to cross a frame.
//
// THE OP IS A KEYED `replace`: every key new, so every row is built and nothing survives to be
// moved — the op that prices `make` rather than the reconcile around it (`reorderShare.ts`).
//
// `bun packages/harness/scripts/selectedRowShare.ts [rows]` — reports which path the compiler took
// for each arm, read off the emitted module, beside what it cost.

import { chromium } from '@playwright/test'

import { LAYER_RECONCILE } from '#ui/LAYER_NAMES.ts'

import { buildCompiledPage, openCompiledPage } from './buildCompiledPage.ts'
import { median, spread } from './median.ts'
import { milliseconds } from './milliseconds.ts'
import { type ArmSample, traceArm } from './traceArm.ts'

const ROWS = Number(process.argv[2] ?? '1000')
const RUNS = 5

const page = (row: string): string => `<script>
import { reactive } from '@abide/abide'

const rows = reactive(
    Array.from({ length: ${ROWS} }, (_, at) => ({ id: at, label: 'row ' + at })),
)
let selected = reactive(3)

function replace() {
    rows.set(
        Array.from({ length: ${ROWS} }, (_, at) => ({
            id: ${ROWS} + at,
            label: 'new ' + at,
        })),
    )
}
</script>

<ul id="list">
{#for row of rows by row.id}
    ${row}
{/for}
</ul>
<button id="replace" onclick={replace}>replace</button>`

const ARMS: Record<string, string> = {
    'selected row': page(
        '<li aria-selected={selected === row.id}><span>{row.label}</span></li>',
    ),
    // THE SAME ROW WITHOUT THE PAGE READ — what a row costs when it is built and binds nothing
    // beyond its item. The floor the selected row can reach, not a target it must.
    'plain row': page('<li><span>{row.label}</span></li>'),
    // A BLOCK INSIDE THE ROW: the row is built, and the block inside it is an empty anchor pair
    // its own machinery fills on the mount's first run — by PARSING its arm, once a row.
    'nested block': page(
        '<li>{#if row.id >= 0}<b>on</b>{/if}<span>{row.label}</span></li>',
    ),
    // THE MACHINERY WITHOUT THE PARSE: an arm with nothing in it is filled with '', which
    // `fillRegion` answers without invoking the parser — the watch still runs, and an arm that
    // binds nothing has no scope or mount to run.
    'empty block': page(
        '<li>{#if row.id >= 0}{/if}<span>{row.label}</span></li>',
    ),
    // The same nodes with no block around the `<b>`: what the row costs when nothing is filled.
    'same, no block': page('<li><b>on</b><span>{row.label}</span></li>'),
}

const browser = await chromium.launch()
try {
    console.log(
        `\n=== keyed replace of ${ROWS} rows, Chromium, median of ${RUNS} ===`,
    )
    for (const [name, source] of Object.entries(ARMS)) {
        const built = await buildCompiledPage(source)
        // BUILT where the row's `make` creates its `<li>`; every build also carries a parse for a
        // `Raw` value, so the presence of `markupNodes` alone says nothing.
        const path = built.script.includes('createElement("li")')
            ? 'BUILT a row'
            : built.script.includes('markupNodes(')
              ? 'PARSED a row'
              : 'unknown'
        const samples: ArmSample[] = []
        for (let run = 0; run < RUNS; run += 1) {
            const tab = await openCompiledPage(browser, built)
            samples.push(await traceArm(tab, 'replace', LAYER_RECONCILE))
            // THE ROWS ARE CHECKED, not assumed: an arm that built nothing is the fastest on the table.
            const count = await tab.evaluate(
                () => document.querySelectorAll('#list li').length,
            )
            if (count !== ROWS)
                throw new Error(`built ${count} rows where ${ROWS} are due`)
            await tab.context().close()
        }
        console.log(
            `  ${name.padEnd(13)} ${path.padEnd(13)} op ${milliseconds(median(samples.map((s) => s.opNanoseconds)))} ms` +
                `   abide.reconcile ${milliseconds(median(samples.map((s) => s.layerNanoseconds)))} ms` +
                `   spread ${spread(
                    samples.map((s) => s.layerNanoseconds),
                    milliseconds,
                )}` +
                `   recalc ${median(samples.map((s) => s.recalcStyle))}  layout ${median(samples.map((s) => s.layoutCount))}`,
        )
    }
} finally {
    await browser.close()
}
