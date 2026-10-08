// THE LIVE READING, assembled in the page. Everything `harness/measure` and
// `harness/report` can produce without leaving the browser, plus the two things the
// browser itself knows and no lane does — paint timing and long tasks.
//
// WHAT IS NOT HERE, and cannot be: style recalcs, layout count, paint count and
// forced layout are `harness/engine`, which is CDP and therefore chromium and
// therefore the playwright side. Heap counts are `bun:jsc`. Neither is a gap in this
// function; both are properties of the lane, and a panel that faked them would be
// making a claim about an instrument it does not have.

import { batch } from '../report/batch.ts'
import { clockResolution } from '../report/clock.ts'
import { emulatedDom } from '../report/environment.ts'
import { type Ratio, ratio } from '../report/ratio.ts'
import type { Sample } from '../report/Sample.ts'
import { substrate } from '../report/substrate.ts'
import { disarmCase, measure } from './case.ts'
import type { ArmReading, Reading } from './Reading.ts'
import type { Work } from './Work.ts'

let longTasks = 0

/**
 * Starts counting long tasks for the `Reading`. No-op where there is no observer.
 *
 * Counted from document-start, because a long task during load is over before anything could
 * ask about it.
 */
export function watchLongTasks(): void {
    if (typeof PerformanceObserver === 'undefined') return
    try {
        new PerformanceObserver((list) => {
            longTasks += list.getEntries().length
        }).observe({ type: 'longtask', buffered: true })
    } catch {
        // Safari has no `longtask` entry type. An absent observer reports 0, and the
        // panel says which engine the 0 came from.
    }
}

/** The start time of the named paint entry, or null when the browser recorded none. */
function paintAt(name: string): number | null {
    if (typeof performance.getEntriesByType !== 'function') return null
    for (const entry of performance.getEntriesByType('paint'))
        if (entry.name === name) return entry.startTime
    return null
}

// A READER IS WAITING, and the clock decides what that costs. The bar is 100x the
// clock's measured resolution per batch: 10 ms in chromium and 100 ms in webkit,
// which clamps `performance.now()` to 1 ms. At these counts that is ~140 ms of
// blocking script in chromium and ~1.4 s in webkit, both under the budget and both
// the honest price of the clock the browser gave us.
const PANEL_REPS = 5
const PANEL_WARMUP = 2
const PANEL_BUDGET_NANOSECONDS = 5_000_000_000

/**
 * Closes the load case, counts and times each arm, and assembles the page's `Reading`.
 *
 * Runs once per frame lifetime: reading the load case closes it, so a second call throws.
 */
export function profile(spec: {
    op: string
    /**
     * ARM NAME -> THE OP, and every arm that exists goes in ONE call.
     *
     * Growing `n` per arm separately makes the two incomparable and `ratio()` refuses them on
     * exactly that, so two arms cannot be measured by two invocations of this.
     *
     * Today a docs frame can supply one: the hand-written arm is what the frame runs, and no
     * abide arm exists to load beside it until the compiler does. The shape is the two-arm one
     * regardless, so adding the second is a key here.
     */
    runs?: Record<string, () => void>
    /**
     * Which arm the others are a ratio AGAINST.
     *
     * The hand-written one, always — a performance claim is a ratio against hand-written code in
     * the same substrate.
     */
    baseline?: string
    loadedArm: string
    scriptBytes: number
}): Reading {
    const runs = spec.runs ?? {}
    const names = Object.keys(runs)
    // Refused before the load case closes, because a baseline no arm answers to is a
    // Reading with every ratio silently missing.
    if (spec.baseline !== undefined && !Object.hasOwn(runs, spec.baseline))
        throw new Error(
            `profile("${spec.op}") names baseline "${spec.baseline}", which is not one of its runs (${names.join(', ') || 'none'}).`,
        )
    // The load case was armed at document-start by the caller — the lane leaves that to it,
    // see `injectable.ts`. Reading it is what closes it, so this runs once per frame lifetime
    // and a second call would throw.
    const load = disarmCase()
    const arms: Record<string, ArmReading> = {}
    const ratios: Record<string, Ratio> = {}
    let timing: Reading['timing'] = null

    if (names.length > 0) {
        // COUNTING AND TIMING ARE TWO PASSES over the same body, and in that order:
        // the counter runs inside the path it counts, so a duration taken with it
        // armed is a duration of the instrument.
        const work: Record<string, Work> = {}
        for (const name of names) work[name] = measure(runs[name] as () => void)

        const run = batch({
            case: spec.op,
            arms: runs,
            // A REAL BROWSER IS NOT AN EMULATOR, so the panel reads `null` here and can
            // carry a duration at all where `bun test` cannot — and a run under bun's DOM
            // reads `'dom'`, which `batch` refuses.
            emulated: emulatedDom(),
            reps: PANEL_REPS,
            warmup: PANEL_WARMUP,
            budgetNanoseconds: PANEL_BUDGET_NANOSECONDS,
        })
        timing = { n: run.n, reps: run.reps, floor: run.floor }
        for (const name of names) {
            const sample = run.samples[name] as Sample
            arms[name] = {
                work: work[name] as Work,
                nanosecondsPerOp: sample.nanoseconds,
                p95: sample.p95,
            }
        }

        const baseline = spec.baseline ?? (names[0] as string)
        const against = run.samples[baseline] as Sample
        for (const name of names) {
            if (name === baseline) continue
            // Through `ratio()` rather than a division: it is what refuses two
            // substrates, two batch sizes, an arm against itself, and a value inside
            // the floor this machine just measured.
            ratios[name] = ratio(run.samples[name] as Sample, against, {
                floor: run.floor,
            })
        }
    }

    return {
        op: spec.op,
        substrate: substrate(),
        agent: globalThis.navigator?.userAgent ?? 'unknown',
        loadedArm: spec.loadedArm,
        load,
        arms,
        ratios,
        timing,
        paint: {
            firstPaint: paintAt('first-paint'),
            firstContentfulPaint: paintAt('first-contentful-paint'),
            longTasks,
        },
        size: {
            nodes: document.getElementsByTagName('*').length,
            scriptBytes: spec.scriptBytes,
        },
        clockNanoseconds: clockResolution(),
    }
}
