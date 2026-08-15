// What the ENGINE did, which nothing inside the page can answer.
//
// `harness/measure` counts the DOM calls a piece of work MADE — nodes created, attributes written,
// listeners attached — by patching the document from inside. That is the right instrument for "does
// this reconcile move rows or rebuild them", and it is available in both substrates, which is why it
// is where it is.
//
// It cannot see what the engine did with those calls. Style recalculation, layout and paint happen
// after the script yields, in the renderer, and no page API reports them: `performance.memory` reads
// 9.5 MB against a renderer holding 2.8 GB, and there is no `document.layoutCount`. So the numbers
// this project's own rules DEMAND — `RecalcStyleCount` and `LayoutCount` before believing an
// existence proof — were reachable only over the devtools protocol, hand-rolled in two e2e files
// that each pulled two of the thirty-six metrics available.
//
// This is that, as an API. Driven from the Playwright side because CDP is: a bench arm runs in the
// page and cannot reach it, which is a fact about where the counters live rather than a choice.
//
// TWO TIERS, because they cost differently:
//
//   · the DEFAULT reads `Performance.getMetrics` — one round trip, exact counters, no instrumentation
//     in the page at all. A forced-layout loop reports LayoutCount 51 for 51 forced layouts.
//   · `{ paint: true }` additionally runs a TRACE, which is the only way to count paints: the
//     `LayerTree.layerPainted` event never fires for ordinary content, and no counter reports paints.
//     A trace also carries `Blink.ForcedStyleAndLayout.UpdateTime`, which is layout thrash — the
//     hot-path rule about a read after a write in the same path, made observable.
//
// NOT PORTABLE, and that is the substrate rule rather than a gap: CDP is Chromium, so every number
// here describes Blink. A cost that only appears in WebKit will not appear here.

import type { Page } from '@playwright/test'

/**
 * What one piece of work cost the engine.
 *
 * Counts and DURATIONS together, because the durations are the layer attribution this project asks
 * for before touching a layer: `scriptMs` against `recalcStyleMs` against `layoutMs` says which one
 * an optimisation would even be capped by. Two rewrites of the reactive core landed as no-ops for
 * want of exactly this number.
 *
 * Every field is a DELTA across the measured work, never a running total.
 */
export interface EngineWork {
    /** Style recalculations. The counter a "faster" claim has to survive — one CSS rule was a 4.5x. */
    recalcStyle: number
    /** Layouts (reflows). A count, not a cost: pair it with `layoutMs`. */
    layout: number
    /**
     * DOM nodes the document holds, as a delta.
     *
     * LIVE nodes, not attached ones — which is the whole of the subtlety. Detaching a subtree does not
     * move this until the nodes are collected, so a removal reads 0 and an addition reads what it
     * added. Measured with `{ collect: true }` it becomes RETAINED, the same reading goes negative on
     * that removal (-1,164 for a 300-span subtree and the page's own garbage with it), and a leak is
     * the difference between the two.
     */
    nodes: number
    /** Layout objects — nodes WITH a box, which is what a reflow actually walks. */
    layoutObjects: number
    /** Event listeners attached and not removed. A binding that re-attaches per patch shows here. */
    listeners: number

    /** Milliseconds in script. */
    scriptMs: number
    /** Milliseconds recalculating style. */
    recalcStyleMs: number
    /** Milliseconds in layout. */
    layoutMs: number
    /**
     * Milliseconds on the main thread's task queue — the denominator the three above are shares OF.
     *
     * The WHOLE task, including everything the page did in the window that was not this work: event
     * dispatch, the driver's own round trips, an unrelated timer. So a share is a floor on what the
     * layer cost and never a ceiling, and `other` being large is usually the window rather than a
     * mystery layer. Narrow the window to narrow the answer.
     */
    taskMs: number

    /** JS heap bytes. Not the DOM's memory: nodes are not on this heap. See `profile.e2e.ts`. */
    heapBytes: number

    /**
     * Paints. `undefined` unless the session was opened with `{ paint: true }`.
     *
     * Absent rather than zero, so "not measured" and "measured, none" are different answers. A zero
     * here is a real claim — the work changed nothing the compositor had to redraw.
     */
    paint: number | undefined
    /**
     * FORCED style-and-layout: a layout the script demanded mid-run by reading geometry it had just
     * invalidated. `undefined` unless `{ paint: true }`.
     *
     * The one number here that names a BUG rather than a cost. Every one of these is a pipeline
     * flush inside the script, and on a per-row path one is the whole frame.
     */
    forcedLayout: number | undefined
}

export interface EngineOptions {
    /**
     * Run a trace around each measurement, which is what fills in `paint` and `forcedLayout`.
     *
     * Off by default because it is the expensive tier: a trace streams every timeline event for the
     * duration of the work rather than reading four counters, so a measurement goes from one round
     * trip to thousands of events. Turn it on for the claim that needs it, not for every spec.
     */
    paint?: boolean
    /**
     * Force a collection before each reading, which turns `nodes` and `heapBytes` from "not yet
     * swept" into RETAINED.
     *
     * This is the option a LEAK is measured with, and without it a leak and a pending sweep are the
     * same number. It also makes a removal legible: detaching 300 spans reads 0 nodes uncollected and
     * −1,164 collected. Off by default because a collection is the most disruptive thing that can be
     * dropped into a measurement — it must never land between the passes of a timing bench, which is
     * why `/bench` cannot take these readings and this lane exists instead.
     */
    collect?: boolean
}

export interface Engine {
    /**
     * Every engine number for one piece of work.
     *
     * `run` is awaited, and the reading is taken after the page has gone quiet — a layout the work
     * caused lands after the script yields, so sampling the instant `run` resolves attributes it to
     * whatever is measured next.
     */
    around(run: () => unknown): Promise<EngineWork>
    /** Detach. Playwright closes the session with the page, so this is for a long-lived context. */
    close(): Promise<void>
}

/** The metric names read off `Performance.getMetrics`, asserted present rather than assumed. */
const REQUIRED = [
    'RecalcStyleCount',
    'LayoutCount',
    'Nodes',
    'LayoutObjects',
    'JSEventListeners',
    'ScriptDuration',
    'RecalcStyleDuration',
    'LayoutDuration',
    'TaskDuration',
    'JSHeapUsedSize',
] as const

/** Trace events that ARE a paint, and the one that is a forced synchronous layout. */
const PAINT_EVENT = 'Paint'
const FORCED_EVENT = 'Blink.ForcedStyleAndLayout.UpdateTime'

/**
 * The categories a trace has to carry for the two events above, and no more.
 *
 * `devtools.timeline` alone does not carry the forced-layout marker, and the full `blink` category
 * multiplies the event volume by roughly ten for nothing either number reads.
 */
const TRACE_CATEGORIES = ['devtools.timeline', 'disabled-by-default-devtools.timeline']

interface TraceEvent {
    name: string
}

/**
 * Open an engine session on a page.
 *
 * One session per page rather than per measurement: `Performance.enable` and the CDP attach are the
 * fixed cost, and paying them per `around()` would put them inside the thing being measured.
 */
export async function engine(page: Page, options: EngineOptions = {}): Promise<Engine> {
    const tracing = options.paint === true
    const collecting = options.collect === true
    const session = await page.context().newCDPSession(page)
    await session.send('Performance.enable')
    if (collecting) await session.send('HeapProfiler.enable')

    const sample = async (): Promise<Map<string, number>> => {
        if (collecting) await session.send('HeapProfiler.collectGarbage')
        const got = (await session.send('Performance.getMetrics')) as {
            metrics: { name: string; value: number }[]
        }
        const named = new Map<string, number>()
        for (const metric of got.metrics) named.set(metric.name, metric.value)
        for (const name of REQUIRED) {
            if (!named.has(name)) throw new Error(`harness: Performance.getMetrics has no "${name}"`)
        }
        return named
    }

    return {
        async around(run: () => unknown): Promise<EngineWork> {
            let paints = 0
            let forced = 0
            const collect = (payload: unknown): void => {
                const { value } = payload as { value?: TraceEvent[] }
                if (value === undefined) return
                for (const event of value) {
                    if (event.name === PAINT_EVENT) paints++
                    else if (event.name === FORCED_EVENT) forced++
                }
            }

            if (tracing) {
                session.on('Tracing.dataCollected' as never, collect as never)
                await session.send('Tracing.start', {
                    traceConfig: { includedCategories: TRACE_CATEGORIES },
                    transferMode: 'ReportEvents',
                } as never)
            }

            const before = await sample()
            await run()
            // Two frames, so the style-recalculate-layout-paint sequence the work started lands inside
            // its own window rather than being billed to whatever is measured next.
            //
            // INSURANCE, NOT A DEMONSTRATED FIX, and worth saying so rather than letting the next
            // reader assume it was load-bearing: removing it changes no reading in `engine-work.e2e.ts`,
            // including the case written specifically to catch a deferred layout being misattributed.
            // The `Performance.getMetrics` round trip below is itself slower than a frame, so the
            // pipeline has already run by the time the sample is taken. That is an accident of CDP
            // latency rather than something this file arranged, which is the whole reason to keep the
            // two frames: they cost ~33 ms per reading and make the guarantee explicit instead of
            // incidental. Delete them the day a measurement is fast enough for that to be false.
            await page.evaluate(
                () =>
                    new Promise<void>((done) => {
                        requestAnimationFrame(() => requestAnimationFrame(() => done()))
                    }),
            )
            const after = await sample()

            if (tracing) {
                const finished = new Promise<void>((done) => {
                    session.once('Tracing.tracingComplete' as never, (() => done()) as never)
                })
                await session.send('Tracing.end')
                await finished
                session.off('Tracing.dataCollected' as never, collect as never)
            }

            const delta = (name: string): number => (after.get(name) ?? 0) - (before.get(name) ?? 0)
            // The durations are seconds on the wire and milliseconds in every rule that reads them.
            const ms = (name: string): number => delta(name) * 1000

            return {
                recalcStyle: delta('RecalcStyleCount'),
                layout: delta('LayoutCount'),
                nodes: delta('Nodes'),
                layoutObjects: delta('LayoutObjects'),
                listeners: delta('JSEventListeners'),
                scriptMs: ms('ScriptDuration'),
                recalcStyleMs: ms('RecalcStyleDuration'),
                layoutMs: ms('LayoutDuration'),
                taskMs: ms('TaskDuration'),
                heapBytes: delta('JSHeapUsedSize'),
                paint: tracing ? paints : undefined,
                forcedLayout: tracing ? forced : undefined,
            }
        },
        async close(): Promise<void> {
            await session.detach()
        },
    }
}

/**
 * What share of the op each layer took, as fractions of `taskMs`.
 *
 * The rule this exists for is "NAME THE SHARE BEFORE CHANGING THE LAYER": an optimisation is capped
 * by the fraction of the op it touches, and the fraction is one reading away. `other` is what is left
 * once script, style and layout are accounted for — paint, compositing and the parts of the task no
 * counter here separates.
 *
 * Every field is 0 when `taskMs` is 0, which is what an op under the counter's resolution reads as.
 * That is a real answer: there is no share to name because there is no time to divide.
 */
export function shares(work: EngineWork): { script: number; recalcStyle: number; layout: number; other: number } {
    if (work.taskMs <= 0) return { script: 0, recalcStyle: 0, layout: 0, other: 0 }
    const script = work.scriptMs / work.taskMs
    const recalcStyle = work.recalcStyleMs / work.taskMs
    const layout = work.layoutMs / work.taskMs
    return { script, recalcStyle, layout, other: Math.max(0, 1 - script - recalcStyle - layout) }
}
