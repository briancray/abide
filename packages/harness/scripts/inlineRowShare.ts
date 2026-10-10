// WHAT AN INLINE COMPONENT COSTS A ROW. `{#component Name(pattern)}` written in a `{#for}` row is a
// function declared in the row's mount, closing over the row (32.42), so a row that declares one
// pays a closure per mount whether or not it invokes it — and a row that invokes it pays the
// invocation a file component does. This prices both at the n where a row cost could cross a frame.
//
// THE OP IS A KEYED `replace`, as in `selectedRowShare.ts`: every key new, so every row is built and
// mounted and nothing survives — the op that prices a row's mount rather than the reconcile around
// it. Every arm reads page state (`selected`), so the row's mount is never the shared empty one and
// the declaration is emitted in each (a region that mounts nothing declares nothing, 32.43).
//
// `bun packages/harness/scripts/inlineRowShare.ts [rows]`

import { chromium } from '@playwright/test'
import { LAYER_RECONCILE } from '../../abide/src/ui/LAYER_NAMES.ts'
import { buildCompiledPage, openCompiledPage } from './buildCompiledPage.ts'
import { median, spread } from './median.ts'
import { milliseconds } from './milliseconds.ts'
import { type ArmSample, traceArm } from './traceArm.ts'

const ROWS = Number(process.argv[2] ?? '1000')
const RUNS = 5

const page = (row: string, imports = ''): string => `<script>
import { reactive } from '@abide/abide'
${imports}
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

const LABEL = `<script>
import { props } from '@abide/abide'

const { label } = props<{ label: string }>()
</script>
<span>{label}</span>`

const ARMS: Record<
    string,
    { source: string; components?: Record<string, string> }
> = {
    // THE ROW WITHOUT ONE: what every other arm is read against.
    'plain row': {
        source: page(
            '<li aria-selected={selected === row.id}><span>{row.label}</span></li>',
        ),
    },
    // THE DECLARATION ALONE: the same row, and a component it declares and never invokes.
    declared: {
        source: page(
            '{#component Mark()}<b>{row.label}</b>{/component}<li aria-selected={selected === row.id}><span>{row.label}</span></li>',
        ),
    },
    // DECLARED AND INVOKED: the `<span>` written by an inline component that reads the row.
    invoked: {
        source: page(
            '{#component Label()}<span>{row.label}</span>{/component}<li aria-selected={selected === row.id}><Label/></li>',
        ),
    },
    // THE SAME `<span>` FROM A FILE: the invocation with no declaration, handed the row as a prop.
    'file component': {
        source: page(
            '<li aria-selected={selected === row.id}><Label label={row.label}/></li>',
            "import Label from './Label.abide'",
        ),
        components: { Label: LABEL },
    },
}

const browser = await chromium.launch()
try {
    console.log(
        `\n=== keyed replace of ${ROWS} rows, Chromium, median of ${RUNS} ===`,
    )
    for (const [name, arm] of Object.entries(ARMS)) {
        const built = await buildCompiledPage(arm.source, arm.components)
        // THE DECLARATION IS CHECKED, not assumed: an arm whose row mount declares nothing is the
        // plain row under another name.
        const declares =
            /\b(Mark|Label) = function\b|function (Mark|Label)\b/.test(
                built.script,
            )
        const samples: ArmSample[] = []
        for (let run = 0; run < RUNS; run += 1) {
            const tab = await openCompiledPage(browser, built)
            samples.push(await traceArm(tab, 'replace', LAYER_RECONCILE))
            const count = await tab.evaluate(
                () => document.querySelectorAll('#list li').length,
            )
            if (count !== ROWS)
                throw new Error(`built ${count} rows where ${ROWS} are due`)
            await tab.context().close()
        }
        const layer = median(samples.map((s) => s.layerNanoseconds))
        console.log(
            `  ${name.padEnd(15)} ${declares ? 'declares' : '        '}  op ${milliseconds(median(samples.map((s) => s.opNanoseconds)))} ms` +
                `   abide.reconcile ${milliseconds(layer)} ms (${(layer / ROWS).toFixed(0)} ns a row)` +
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
