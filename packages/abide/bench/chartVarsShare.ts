// WHAT A CHART'S PERCENT VARS COST A REDRAW. A positioned part can carry its place as `--x` / `--y`
// in `style` (52.116) beside the SVG attribute that places it, and on an `<svg>` root no rule reads
// them. This prices that writing against the whole redraw: the same 200-x chart (a line and a column
// series, 400 points and 200 columns) drawn three times on one page, each redraw a change of every
// value, flushed and laid out — paint is outside the op, so a share is an upper bound.
//
// MEASURED, chromium, batched (n 14, nine reps), twice: as handed back on an `<svg>` root, 1.00 and
// 1.02 ms; with the vars written beside the attributes, 1.83 and 1.83 — the vars were 45% of the
// redraw, against an A/A floor of 2-4%. Placed by the vars alone (`cx: var(--x)` and the rect's
// `x`/`y`/`width`/`height` read from them in `style`, which WebKit and Chromium both honor and both
// ease), 1.86 and 1.89: one `style` write a mark costs what the style AND the attributes did, so the
// cost is the inline style, not the attribute count. Hence 52.116 writes the vars only where the root
// is not an `<svg>`. Before this, an `<svg>` root redrew in 1.83 ms with the vars and 1.17 without,
// its columns placed by a `transform` in `style`; as attributes they are the cheaper arm.
//
// `bun run bench:chart-vars`

import { claimOf, ratio, type Sample } from '@abide/harness/report'
import { chromium } from '@playwright/test'

import { buildCompiledPage, loadCompiledPage } from './buildCompiledPage.ts'

const RUNS = 2

const PAGE = `<script>
import { chart, flushSync, reactive } from '@abide/abide'
import { batch } from '@abide/harness/report'

const X = 200
const valuesAt = (shift: number) =>
    Array.from({ length: X }, (_, at) => 50 + 40 * Math.sin((at + shift) / 9))
const seriesOf = (shift: number) => [
    { label: 'line', values: valuesAt(shift) },
    { label: 'columns', values: valuesAt(shift + 30), kind: 'column' as const },
]
const shiftHanded = reactive(0)
const shiftVars = reactive(0)
const shiftStyle = reactive(0)
const first = chart({ label: 'handed', series: () => seriesOf(shiftHanded) })
const second = chart({ label: 'vars', series: () => seriesOf(shiftVars) })
const third = chart({ label: 'style', series: () => seriesOf(shiftStyle) })
type Point = { x: number; y: number }
type Bar = Point & { width: number; height: number }
const percentOf = (part: number, whole: number) =>
    whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 100

const boxWidth = () => third.root.width as number
const boxHeight = () => third.root.height as number

// As the chart hands each part back, copied so every arm pays one spread of a fresh record.
const same = (part: Record<string, unknown> | undefined) => ({ ...part })
// Placed by attributes, and carrying the vars beside them: what an \`<svg>\` root wrote before 52.116
// left the vars to a root that is not one.
const pointWithVars = (part: Record<string, unknown>, point: Point) => ({
    ...part,
    style: \`--x: \${percentOf(point.x, boxWidth())}%; --y: \${percentOf(point.y, boxHeight())}%\`,
})
const barWithVars = (part: Record<string, unknown>, bar: Bar) => ({
    ...part,
    style: \`--x: \${percentOf(bar.x, boxWidth())}%; --y: \${percentOf(bar.y, boxHeight())}%; --width: \${percentOf(bar.width, boxWidth())}%; --height: \${percentOf(bar.height, boxHeight())}%\`,
})
// Placed by CSS alone, from the vars: the SVG geometry properties read them, one style a mark.
const pointByStyle = (point: Point) => ({
    'data-chart': 'point', fill: 'currentColor',
    style: \`--x: \${percentOf(point.x, boxWidth())}%; --y: \${percentOf(point.y, boxHeight())}%; cx: var(--x); cy: var(--y)\`,
})
const barByStyle = (bar: Bar) => ({
    'data-chart': 'bar', fill: 'currentColor',
    style: \`--x: \${percentOf(bar.x, boxWidth())}%; --y: \${percentOf(bar.y, boxHeight())}%; --width: \${percentOf(bar.width, boxWidth())}%; --height: \${percentOf(bar.height, boxHeight())}%; x: var(--x); y: var(--y); width: var(--width); height: var(--height)\`,
})

const redraw = (shift: typeof shiftHanded, at: number) => () => {
    shift.set(shift.peek() + 1)
    flushSync()
    ;(document.getElementById('arm' + at) as Element).getBoundingClientRect()
}

;(globalThis as unknown as Record<string, unknown>).__CHART_VARS__ = () => {
    const run = batch({
        case: 'chart redraw, 200 x',
        arms: {
            'as handed back': redraw(shiftHanded, 0),
            'vars written too': redraw(shiftVars, 1),
            'placed by style only': redraw(shiftStyle, 2),
        },
        emulated: null,
        reps: 9,
        budgetNanoseconds: 60_000_000_000,
    })
    return { n: run.n, floor: run.floor, samples: run.samples }
}
</script>

<svg {...first.root} id="arm0">
    {#for tick of first.yTicks}
        <line {...tick.grid} />
    {/for}
    {#for bar of first.bars key bar.key}
        <rect {...same(bar.rect)} />
    {/for}
    {#for line of first.lines key line.series}
        <path {...line.path} />
    {/for}
    {#for point of first.points key point.key}
        <circle {...same(point.circle)} r="3" />
    {/for}
</svg>
<svg {...second.root} id="arm1">
    {#for tick of second.yTicks}
        <line {...tick.grid} />
    {/for}
    {#for bar of second.bars key bar.key}
        <rect {...barWithVars(bar.rect, bar)} />
    {/for}
    {#for line of second.lines key line.series}
        <path {...line.path} />
    {/for}
    {#for point of second.points key point.key}
        <circle {...pointWithVars(point.circle, point)} r="3" />
    {/for}
</svg>
<svg {...third.root} id="arm2">
    {#for tick of third.yTicks}
        <line {...tick.grid} />
    {/for}
    {#for bar of third.bars key bar.key}
        <rect {...barByStyle(bar)} />
    {/for}
    {#for line of third.lines key line.series}
        <path {...line.path} />
    {/for}
    {#for point of third.points key point.key}
        <circle {...pointByStyle(point)} r="3" />
    {/for}
</svg>`

const built = await buildCompiledPage(PAGE)
const browser = await chromium.launch()
try {
    for (let run = 1; run <= RUNS; run += 1) {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 800 },
        })
        await loadCompiledPage(page, built)
        // THE ARMS ARE CHECKED, not assumed: what each writes is what it is priced for.
        const written = await page.evaluate(() => {
            const count = (selector: string) =>
                document.querySelectorAll(selector).length
            return [0, 1, 2].map((at) => ({
                points: count(`#arm${at} circle`),
                bars: count(`#arm${at} rect`),
                vars: count(`#arm${at} [style*="--x"]`),
                cy: count(`#arm${at} circle[cy]`),
            }))
        })
        console.log(`run ${run}: ${JSON.stringify(written)}`)
        const result = (await page.evaluate(() =>
            (
                globalThis as unknown as { __CHART_VARS__: () => unknown }
            ).__CHART_VARS__(),
        )) as {
            n: number
            floor: number
            samples: Record<string, Sample>
        }
        const handed = result.samples['as handed back'] as Sample
        const lines = [
            `run ${run}: n ${result.n}, A/A floor ${(result.floor * 100).toFixed(1)}%`,
        ]
        // 43.7 — against `as handed back` through `ratio()`, so a share inside the floor says so.
        for (const [name, sample] of Object.entries(result.samples))
            lines.push(
                `  ${name.padEnd(28)} ${(sample.nanoseconds / 1e6).toFixed(3)} ms   ${
                    sample === handed
                        ? 'base'
                        : `${claimOf(ratio(sample, handed, { floor: result.floor }))} of as handed back`
                }`,
            )
        console.log(lines.join('\n'))
        await page.close()
    }
} finally {
    await browser.close()
}
