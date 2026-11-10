// A KEYED `replace` PRICED PER ARM, for the scripts that ask what one row shape costs against
// another: every key new, so every row is built and mounted and nothing survives to be moved — the
// op that prices a row's mount rather than the reconcile around it (`reorderShare.ts`).

import { chromium } from '@playwright/test'

import { LAYER_RECONCILE } from '#ui/LAYER_NAMES.ts'

import { buildCompiledPage, openCompiledPage } from './buildCompiledPage.ts'
import { median, spread } from './median.ts'
import { milliseconds } from './milliseconds.ts'
import { type ArmSample, traceArm } from './traceArm.ts'

const RUNS = 5

/**
 * A page of `rows` keyed rows, each written `row`, with page state (`selected`) for a row to read
 * and a `#replace` button that swaps every key.
 */
export const replacePage = (
    rows: number,
    row: string,
    imports = '',
): string => `<script>
import { reactive } from '@abide/abide'
${imports}
const rows = reactive(
    Array.from({ length: ${rows} }, (_, at) => ({ id: at, label: 'row ' + at })),
)
let selected = reactive(3)

function replace() {
    rows.set(
        Array.from({ length: ${rows} }, (_, at) => ({
            id: ${rows} + at,
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

/**
 * Each arm's `replace`, in Chromium, the median of five, printed one line an arm with what `probe`
 * reads off the emitted script beside it — the path the compiler took, CHECKED rather than assumed.
 */
export async function priceRowArms(
    rows: number,
    arms: Record<
        string,
        { source: string; components?: Record<string, string> }
    >,
    probe: (script: string) => string,
): Promise<void> {
    const width = Math.max(...Object.keys(arms).map((name) => name.length))
    const browser = await chromium.launch()
    try {
        console.log(
            `\n=== keyed replace of ${rows} rows, Chromium, median of ${RUNS} ===`,
        )
        for (const [name, arm] of Object.entries(arms)) {
            const built = await buildCompiledPage(arm.source, arm.components)
            const samples: ArmSample[] = []
            for (let run = 0; run < RUNS; run += 1) {
                const tab = await openCompiledPage(browser, built)
                samples.push(await traceArm(tab, 'replace', LAYER_RECONCILE))
                // THE ROWS ARE CHECKED, not assumed: an arm that built nothing is the fastest on
                // the table.
                const count = await tab.evaluate(
                    () => document.querySelectorAll('#list li').length,
                )
                if (count !== rows)
                    throw new Error(`built ${count} rows where ${rows} are due`)
                await tab.context().close()
            }
            const layer = median(samples.map((s) => s.layerNanoseconds))
            console.log(
                `  ${name.padEnd(width)}  ${probe(built.script)}  op ${milliseconds(median(samples.map((s) => s.opNanoseconds)))} ms` +
                    `   abide.reconcile ${milliseconds(layer)} ms (${(layer / rows).toFixed(0)} ns a row)` +
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
}
