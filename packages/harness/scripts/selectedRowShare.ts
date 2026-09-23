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

import { chromium, type Page } from '@playwright/test'
import { traceOp } from '../src/engine/traceOp.ts'
import { buildCompiledPage } from './buildCompiledPage.ts'

const LAYER_RECONCILE = 'abide.reconcile'
const ROWS = Number(process.argv[2] ?? '1000')
const RUNS = 5

const page = (row: string): string => `<script>
import { reactive } from 'abide'

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
    // `fillRegion` answers without invoking the parser — every scope, watch and mount still runs.
    'empty block': page(
        '<li>{#if row.id >= 0}{/if}<span>{row.label}</span></li>',
    ),
    // The same nodes with no block around the `<b>`: what the row costs when nothing is filled.
    'same, no block': page('<li><b>on</b><span>{row.label}</span></li>'),
}

type Sample = { op: number; layer: number; recalc: number; layout: number }

async function once(
    browser: import('@playwright/test').Browser,
    built: {
        markup: string
        script: string
    },
): Promise<Sample> {
    const context = await browser.newContext()
    await context.addInitScript(() => {
        ;(
            globalThis as unknown as { __ABIDE_LAYERS__: boolean }
        ).__ABIDE_LAYERS__ = true
    })
    const tab: Page = await context.newPage()
    await tab.goto('about:blank')
    await tab.setContent(
        `<!doctype html><html><body>${built.markup}</body></html>`,
    )
    await tab.addScriptTag({ content: built.script })
    await tab.evaluate(() => {
        ;(globalThis as unknown as { __MOUNT__?: () => void }).__MOUNT__?.()
    })
    const trace = await traceOp(tab, 'replace-to-paint', async () => {
        await tab.evaluate(async (layerName) => {
            const lane = globalThis as unknown as { __FLUSH__?: () => void }
            performance.mark('op:start')
            ;(document.querySelector('#replace') as HTMLElement).click()
            lane.__FLUSH__?.()
            await new Promise<void>((resolve) => {
                const tick = (): void => {
                    if (performance.getEntriesByName(layerName).length > 0)
                        requestAnimationFrame(() => resolve())
                    else requestAnimationFrame(tick)
                }
                requestAnimationFrame(tick)
            })
            performance.mark('op:end')
            performance.measure('replace-to-paint', 'op:start', 'op:end')
        }, LAYER_RECONCILE)
    })
    // THE ROWS ARE CHECKED, not assumed: an arm that built nothing is the fastest on the table.
    const count = await tab.evaluate(
        () => document.querySelectorAll('#list li').length,
    )
    if (count !== ROWS)
        throw new Error(`built ${count} rows where ${ROWS} are due`)
    await context.close()
    const op = trace.measures.find(
        (measure) => measure.name === 'replace-to-paint',
    )
    if (op === undefined) throw new Error('no replace-to-paint measure')
    let layer = 0
    for (const measure of trace.measures)
        if (measure.name === LAYER_RECONCILE)
            layer += measure.endNanoseconds - measure.startNanoseconds
    return {
        op: op.endNanoseconds - op.startNanoseconds,
        layer,
        recalc: trace.counters.recalcStyle,
        layout: trace.counters.layout,
    }
}

const median = (values: number[]): number => {
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)] as number
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
        const samples: Sample[] = []
        for (let run = 0; run < RUNS; run += 1)
            samples.push(await once(browser, built))
        const ms = (ns: number): string => (ns / 1e6).toFixed(2)
        console.log(
            `  ${name.padEnd(13)} ${path.padEnd(13)} op ${ms(median(samples.map((s) => s.op)))} ms` +
                `   abide.reconcile ${ms(median(samples.map((s) => s.layer)))} ms` +
                `   spread ${ms(Math.min(...samples.map((s) => s.layer)))}-${ms(Math.max(...samples.map((s) => s.layer)))}` +
                `   recalc ${median(samples.map((s) => s.recalc))}  layout ${median(samples.map((s) => s.layout))}`,
        )
    }
} finally {
    await browser.close()
}
