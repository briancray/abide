// NAME THE SHARE BEFORE CHANGING THE LAYER, over the real docs app. Two rewrites of the
// reactive core landed as no-ops because the path they improved is 0.055 of a 1.45 ms op,
// and this is the number that would have stopped either of them being written.
//
// WHY THIS DOES NOT CALL `shares()`. The engine lane reads its numerator out of the
// `performance.measure` pairs THE CODE UNDER TEST EMITS, and abide emits none —
// `grep -rn 'performance.mark' packages/abide/src` is empty. So there is no numerator for
// "the compiler's layer" or "the reactive core" without instrumenting the framework, and
// the honest stand-in is Blink's own ScriptDuration: every JS-layer change is a SUBSET of
// script, so `script / op` is a ceiling on a ceiling.
//
// It over-estimates twice, both in the safe direction — `layers` are metric deltas over
// the whole traced window, which is wider than the measured op, and `script` is all script
// including the docs app's own. A layer is smaller than this number, never larger. Once a
// layer emits marks of its own, `shares()` is the sharper instrument and this becomes the
// denominator it is priced against.

import { chromium } from '@playwright/test'

import { shares } from '../src/engine/shares.ts'
import { traceOp } from '../src/engine/traceOp.ts'
import { THRESHOLDS } from '../src/report/THRESHOLDS.ts'
import { serveDocsApp } from './serveDocsApp.ts'

// THE LAYER NAMES, SPELLED HERE RATHER THAN IMPORTED. `packages/abide/src/ui/LAYER_NAMES.ts` is
// the source of truth and is framework-internal; pulling it in would either put an abide edge in
// this script or cost three entries on `ui/index.ts`'s budget for a harness convenience. The
// duplication is real and the failure is loud: `shares()` throws "found no measure named" rather
// than reporting a wrong fraction.
const LAYER_NAVIGATE = 'abide.navigate'
const LAYER_MOUNT = 'abide.mount'
const LAYER_FILL = 'abide.fill'

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

function median(values: number[]): number {
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)] as number
}

function milliseconds(nanoseconds: number): string {
    return (nanoseconds / 1e6).toFixed(2)
}

function report(name: string, rows: Row[]): void {
    const op = rows.map((row) => row.opNanoseconds)
    const script = rows.map((row) => row.script)
    const shares = rows.map((row) => row.script / row.opNanoseconds)
    const spread = (values: number[]): string =>
        `${milliseconds(Math.min(...values))} – ${milliseconds(Math.max(...values))}`
    console.log(`\n  ${name}`)
    console.log(
        `    op         median ${milliseconds(median(op)).padStart(8)} ms   spread ${spread(op)}`,
    )
    console.log(
        `    script     median ${milliseconds(median(script)).padStart(8)} ms   spread ${spread(script)}`,
    )
    console.log(
        `    style      median ${milliseconds(median(rows.map((row) => row.style))).padStart(8)} ms`,
    )
    console.log(
        `    layout     median ${milliseconds(median(rows.map((row) => row.layout))).padStart(8)} ms`,
    )
    console.log(
        `    SCRIPT/OP  median ${(median(shares) * 100).toFixed(1)}%   spread ${(Math.min(...shares) * 100).toFixed(1)}% – ${(Math.max(...shares) * 100).toFixed(1)}%   <- the ceiling for any JS-layer change`,
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
        // ARMED BEFORE ABIDE'S MODULE GRAPH LOADS. `measureLayer.ts` reads the flag once into a
        // `const` so the disarmed path is one foldable branch rather than a global read per op —
        // which means an init script and a navigation, not `page.evaluate` after load.
        await context.addInitScript(() => {
            ;(
                globalThis as unknown as { __ABIDE_LAYERS__: boolean }
            ).__ABIDE_LAYERS__ = true
        })
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
        const loadAt = load.measures.find(
            (measure) => measure.name === 'navigation-to-paint',
        )
        if (!loadAt) throw new Error('no navigation-to-paint measure')
        loads.push({
            opNanoseconds: loadAt.endNanoseconds - loadAt.startNanoseconds,
            script: load.layers.script,
            style: load.layers.style,
            layout: load.layers.layout,
            recalcStyle: load.counters.recalcStyle,
            layoutCount: load.counters.layout,
            paint: load.counters.paint,
            forcedLayout: load.counters.forcedLayout,
        })

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
        const navigationAt = navigation.measures.find(
            (measure) => measure.name === 'click-to-paint',
        )
        if (!navigationAt) throw new Error('no click-to-paint measure')
        clicks.push({
            opNanoseconds:
                navigationAt.endNanoseconds - navigationAt.startNanoseconds,
            script: navigation.layers.script,
            style: navigation.layers.style,
            layout: navigation.layers.layout,
            recalcStyle: navigation.counters.recalcStyle,
            layoutCount: navigation.counters.layout,
            paint: navigation.counters.paint,
            forcedLayout: navigation.counters.forcedLayout,
        })

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
                let ran = 0
                for (const measure of navigation.measures)
                    if (measure.name === layer) ran += 1
                const counted = layerRuns[layer] ?? []
                counted.push(ran)
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
        const sorted = [...taken].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)] as number
        const ran = layerRuns[layer] ?? []
        const ranSorted = [...ran].sort((a, b) => a - b)
        console.log(
            `    ${layer.padEnd(16)} median ${(median * 100).toFixed(1)}%   spread ${((sorted[0] as number) * 100).toFixed(1)}% – ${((sorted[sorted.length - 1] as number) * 100).toFixed(1)}%   ran ${ranSorted[Math.floor(ranSorted.length / 2)] ?? 0}x an op`,
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
