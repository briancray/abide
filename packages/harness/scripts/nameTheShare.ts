// NAME THE SHARE BEFORE CHANGING THE LAYER, over the real docs app. Two rewrites of the
// reactive core landed as no-ops because the path they improved is 0.055 of a 1.45 ms op,
// and this is the number that would have stopped either of them being written.
//
// TWO INSTRUMENTS, the blunt one first. Blink's own ScriptDuration is a ceiling: every JS-layer
// change is a SUBSET of script, so `script / op` bounds any of them — and it over-estimates twice,
// both in the safe direction: `layers` are metric deltas over the whole traced window, which is
// wider than the measured op, and `script` includes the docs app's own. Then `shares()`, over the
// `performance.measure` pairs abide emits under `LAYER_NAMES.ts`, which is the sharper instrument
// and is priced against the op the first one measured.

import { chromium } from '@playwright/test'
import {
    LAYER_FILL,
    LAYER_MOUNT,
    LAYER_NAVIGATE,
} from '../../abide/src/ui/LAYER_NAMES.ts'
import { durationOf, measuresNamed, shares } from '../src/engine/shares.ts'
import type { Trace } from '../src/engine/Trace.ts'
import { traceOp } from '../src/engine/traceOp.ts'
import { THRESHOLDS } from '../src/report/THRESHOLDS.ts'
import { armLayers } from './armLayers.ts'
import { median, percent, spread } from './median.ts'
import { milliseconds } from './milliseconds.ts'
import { serveDocsApp } from './serveDocsApp.ts'

// A CONTENT-HEAVY PAGE AND A SHORTER ONE. The op somebody waits on is the whole
// navigation, so the pair is two real docs addresses rather than a fixture: a fixture
// would price a page nobody reads.
const FROM = '/values/derive-a-value-from-other-values'
const TO = '/values/show-a-value-that-changes'
const RUNS = 5

type Row = {
    opNanoseconds: number
    script: number
    style: number
    layout: number
    recalcStyle: number
    layoutCount: number
    paint: number
    forcedLayout: number
}

function rowOf(trace: Trace, op: string): Row {
    return {
        opNanoseconds: durationOf(trace, op),
        script: trace.layers.script,
        style: trace.layers.style,
        layout: trace.layers.layout,
        recalcStyle: trace.counters.recalcStyle,
        layoutCount: trace.counters.layout,
        paint: trace.counters.paint,
        forcedLayout: trace.counters.forcedLayout,
    }
}

function report(name: string, rows: Row[]): void {
    const op = rows.map((row) => row.opNanoseconds)
    const script = rows.map((row) => row.script)
    const shares = rows.map((row) => row.script / row.opNanoseconds)
    console.log(`\n  ${name}`)
    console.log(
        `    op         median ${milliseconds(median(op)).padStart(8)} ms   spread ${spread(op, milliseconds)}`,
    )
    console.log(
        `    script     median ${milliseconds(median(script)).padStart(8)} ms   spread ${spread(script, milliseconds)}`,
    )
    console.log(
        `    style      median ${milliseconds(median(rows.map((row) => row.style))).padStart(8)} ms`,
    )
    console.log(
        `    layout     median ${milliseconds(median(rows.map((row) => row.layout))).padStart(8)} ms`,
    )
    console.log(
        `    SCRIPT/OP  median ${percent(median(shares))}   spread ${spread(shares, percent)}   <- the ceiling for any JS-layer change`,
    )
    console.log(
        `    counters   recalcStyle ${rows.map((row) => row.recalcStyle).join('/')}   layout ${rows.map((row) => row.layoutCount).join('/')}   paint ${rows.map((row) => row.paint).join('/')}   forced ${rows.map((row) => row.forcedLayout).join('/')}`,
    )
}

// AN ORIGIN ALREADY SERVING IS TAKEN AS GIVEN. `serveDocsApp()` builds before it starts,
// and a build is the one thing this must not do to a tree somebody else is working in —
// so `bun run bench:share http://localhost:3131` measures what is already up.
const given = process.argv[2]
const app = given ? null : await serveDocsApp()
const origin = given ?? app?.origin
if (!origin) throw new Error('no origin to measure')

const loads: Row[] = []
const clicks: Row[] = []
const layerShares: Record<string, number[]> = {}
const layerRuns: Record<string, number[]> = {}
const layerRefusals: Record<string, string[]> = {}
const browser = await chromium.launch()
try {
    for (let run = 0; run < RUNS; run += 1) {
        // A FRESH CONTEXT PER RUN: the second load of a page is a different op, and
        // reusing one context prices the cache rather than the framework.
        const context = await browser.newContext()
        await armLayers(context)
        const page = await context.newPage()

        const load = await traceOp(page, 'navigation-to-paint', async () => {
            await page.goto(origin + FROM, { waitUntil: 'load' })
            await page.evaluate(async () => {
                await new Promise((resolve) =>
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve(null)),
                    ),
                )
                const painted = performance.getEntriesByName(
                    'first-contentful-paint',
                )[0]
                if (!painted) throw new Error('no first-contentful-paint entry')
                // `timeOrigin` is the navigation start for a top-level document, so
                // the op is the whole wait: address entered, something on screen.
                performance.measure('navigation-to-paint', {
                    start: 0,
                    end: painted.startTime,
                })
            })
        })
        loads.push(rowOf(load, 'navigation-to-paint'))

        const navigation = await traceOp(page, 'click-to-paint', async () => {
            await page.evaluate(async (href) => {
                const heading = (): string =>
                    document.querySelector('h1')?.textContent ?? ''
                const before = heading()
                const link = document.querySelector(
                    `a[href$="${href}"]`,
                ) as HTMLAnchorElement | null
                if (!link) throw new Error(`no link to ${href}`)
                performance.mark('op:start')
                link.click()
                // THE OP ENDS WHEN THE NEW PAGE IS ON SCREEN, polled by frame. Measured
                // first with a fixed 400 ms wait inside the window, which prices the
                // wait: the op read 405 ms and the share read 0.6%.
                await new Promise<void>((resolve) => {
                    const tick = (): void => {
                        const now = heading()
                        if (now !== before && now !== '')
                            requestAnimationFrame(() => resolve())
                        else requestAnimationFrame(tick)
                    }
                    requestAnimationFrame(tick)
                })
                performance.mark('op:end')
                performance.measure('click-to-paint', 'op:start', 'op:end')
            }, TO)
        })
        clicks.push(rowOf(navigation, 'click-to-paint'))

        // THE FIRST LAYER-SPECIFIC SHARES THIS REPO HAS HAD. Everything above is `script/op`, a
        // ceiling on a ceiling, because abide emitted no marks of its own and `shares()` had no
        // numerator to read. It does now.
        //
        // CAUGHT RATHER THAN THROWN. `shares()` refuses a layer that ran outside its op, and that
        // refusal is a FINDING — a mount that finishes after the op it was supposed to be inside
        // is worth reading, not worth crashing a bench over.
        for (const layer of [LAYER_NAVIGATE, LAYER_MOUNT, LAYER_FILL]) {
            try {
                const share = shares(navigation, {
                    layer,
                    of: 'click-to-paint',
                    threshold: 'interaction',
                })
                const taken = layerShares[layer] ?? []
                taken.push(share.ceilingCpu)
                layerShares[layer] = taken
                // HOW MANY TIMES THE LAYER RAN, which for `abide.fill` is the question: the build
                // emits 90 call sites over the docs app and what matters is how many a real
                // navigation reaches. A count, not a clock.
                const counted = layerRuns[layer] ?? []
                counted.push(measuresNamed(navigation, layer).length)
                layerRuns[layer] = counted
            } catch (thrown) {
                const refused = layerRefusals[layer] ?? []
                refused.push(String(thrown).split('\n')[0] ?? '')
                layerRefusals[layer] = refused
            }
        }
        await context.close()
    }
} finally {
    await browser.close()
    app?.stop()
}

console.log(`\nNAME THE SHARE — chromium/V8, ${RUNS} runs, ${origin}`)
console.log(`  first load: ${FROM}`)
console.log(`  client nav: ${FROM} -> ${TO}`)
report('navigation-to-paint (first load)', loads)
report('click-to-paint (client navigation)', clicks)
// A LAYER SHARE IS WALL CLOCK AND `SCRIPT/OP` IS A CPU CATEGORY, and reading one as the other is
// the mistake this block exists to prevent. `shares()` measures the time between two marks — so a
// layer that FORCES style or layout inside itself carries that work in its number, where Blink
// files it under Layout and not under ScriptDuration.
//
// The two together are the finding rather than a contradiction. Where `abide.navigate` reads far
// above the whole op's `SCRIPT/OP`, the arithmetic bounds it: all script in the op is the smaller
// number, so the remainder of the layer is style and layout it forced. That is a different repair
// from any the rewrite proposals argued — batch the reads, or stop forcing — and it is not
// something `script/op` could ever have shown.
console.log('\n  layers inside click-to-paint, measured rather than bounded')
for (const layer of [LAYER_NAVIGATE, LAYER_MOUNT, LAYER_FILL]) {
    const taken = layerShares[layer]
    const refused = layerRefusals[layer]
    if (taken !== undefined && taken.length > 0) {
        const ran = layerRuns[layer] ?? []
        console.log(
            `    ${layer.padEnd(16)} median ${percent(median(taken))}   spread ${spread(taken, percent)}   ran ${ran.length > 0 ? median(ran) : 0}x an op`,
        )
    }
    // NAMED, NOT COUNTED. A layer that refused every run refused for ONE reason, and the reason is
    // the whole value of the line.
    if (refused !== undefined && refused.length > 0)
        console.log(
            `    ${layer.padEnd(16)} refused ${refused.length}/${RUNS}: ${refused[0]}`,
        )
}
console.log(
    `\n  one frame = ${milliseconds(THRESHOLDS.frame)} ms, interaction budget = ${milliseconds(THRESHOLDS.interaction)} ms\n`,
)
