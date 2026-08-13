// A bench, as rows: every benched case with a cell per number, and nothing about how it looks.
//
// This is the MEASURING half. What comes out of `arm.run()` is a number; what a page does with it is a
// row in a grid, and the two are kept apart here rather than in whichever app is drawing — which is
// also what makes the measurement honest, because the arms run against the same counters and the same
// clock whoever is asking and nothing about a screen is inside the loop that times them.
//
// So no class strings, and that is a constraint rather than a preference: `packages/perf` may not ship
// a stylesheet at all — its shell records that one CSS rule was the whole of a "4.5x faster" reading,
// because Blink builds its style invalidation sets from the stylesheets — so the only table it is
// allowed to draw is a bare one. A row therefore reports FACTS a page can paint: which arm is the
// subject, which is the harness floor, how full a bar would be, and which way the ratio went.
//
// There is no separate list of bench cases anywhere. A bench is a face of the case that already
// demonstrates and tests the same claim, so a row's prose is the case's own note — the three cannot
// drift into describing different things.
//
// The rules this obeys, from the project's own notes:
//
//   · a performance claim is a RATIO against hand-written code — absolute ms describe this machine
//   · a correctness test cannot guard "does less work", so work is COUNTED, not timed
//   · in a reactive system the contract is WAKE-UPS: count re-runs, not values
//   · a case earns its place by DISTINGUISHING implementations — a full reverse cannot tell a
//     minimal keyed reconcile from a rebuild; a two-row swap can

import { type State, state } from 'abide'
import type { Bench, Case, Suite } from '../kit.ts'
import {
    type Arm,
    duration,
    FLOOR,
    frame,
    measureFlush,
    NOISY_SPREAD,
    nonZero,
    quiesce,
    ratioText,
    timeArms,
    verdict,
} from '../measure.ts'

/** One arm's row. One shape for all four kinds, so a row is never two different objects. */
export interface ArmRow {
    label: string
    /** The FIRST arm, which is always abide — the subject the ratio is phrased from. */
    subject: boolean
    /** The harness floor: a measurement of measuring, to be subtracted rather than compared. */
    floor: boolean
    /** The number, however it is counted — a duration, or a count. `—` until it has been run. */
    value: State<string>
    /** 0 to 1, against the slowest arm in the row. Whether that becomes a bar is the page's business. */
    fill: State<number>
    /** `baseline`, `subtract me`, or the ratio against abide. */
    tail: State<string>
    /** Which way that ratio went, for a page to colour. Empty for a row that is not a comparison. */
    tailVerdict: State<'faster' | 'same' | 'slower' | ''>
    /** What was counted, for a wake or a budget arm; the counters that moved, for a work arm. */
    of: State<string>
}

export interface BenchRow {
    suite: string
    title: string
    note: string
    kind: Bench['kind']
    /** `per row · 500 per op`, when a time bench divides its number down. Empty otherwise. */
    per: string
    status: State<string>
    /** A run whose passes were far apart. The minimum is then not representative, and the row says so. */
    noisy: State<boolean>
    arms: ArmRow[]
    run: () => Promise<void>
}

function armRow(label: string, subject: boolean, floor: boolean): ArmRow {
    return {
        label,
        subject,
        floor,
        value: state('—'),
        fill: state(0),
        tail: state(''),
        tailVerdict: state<'faster' | 'same' | 'slower' | ''>(''),
        of: state(''),
    }
}

/**
 * Every benched case across these suites, in order, with its rows already built.
 *
 * The rows exist BEFORE anything runs: an unrun bench still says what it measures and against which
 * hand-written arm, which is most of what a reader came for. Suites are handed in rather than reached
 * for, because which suites exist is a fact about an app and not about a bench.
 */
export function benchRowsOf(suites: Suite[]): BenchRow[] {
    const rows: BenchRow[] = []
    for (const suite of suites) {
        for (const spec of suite.cases) {
            if (spec.bench !== undefined) rows.push(benchRow(suite.name, spec, spec.bench))
        }
    }
    return rows
}

export function benchRow(suite: string, spec: Case, bench: Bench): BenchRow {
    const status = state('not run')
    const noisy = state(false)

    // The arms and the measurement that fills them are decided ONCE, here — the kind is a fact about
    // the case, not a question to re-ask on every run.
    let arms: ArmRow[]
    let paint: () => Promise<void>
    let done: string

    if (bench.kind === 'time') {
        // The floor arm is measured WITH the others, interleaved, because a floor timed on its own in
        // a quiet moment is not the floor these arms actually paid.
        const timed: Arm[] = bench.floor === 'flush' ? [...bench.arms, FLOOR] : bench.arms
        arms = timed.map((arm, i) => armRow(arm.label, arm !== FLOOR && i === 0, arm === FLOOR))
        paint = () => runTime(bench, timed, arms, noisy)
        done = 'best of many batches'
    } else {
        arms = bench.arms.map((arm, i) => armRow(arm.label, i === 0, false))
        paint = bench.kind === 'work' ? () => runWork(bench, arms) : () => runCounted(bench, arms)
        done = 'counted, not timed'
    }

    return {
        suite,
        title: spec.title,
        note: spec.note ?? '',
        kind: bench.kind,
        per:
            bench.kind === 'time' && bench.per !== undefined
                ? `per ${bench.per.label} · ${bench.per.n} per op`
                : '',
        status,
        noisy,
        arms,
        run: async () => {
            status.set('running…')
            noisy.set(false)
            await frame()
            await paint()
            status.set(done)
        },
    }
}

async function runTime(
    bench: Extract<Bench, { kind: 'time' }>,
    timed: Arm[],
    rows: ArmRow[],
    noisy: State<boolean>,
): Promise<void> {
    const timings = await timeArms(timed, quiesce)
    let slowest = 0
    for (const timing of timings) if (timing.nsPerOp > slowest) slowest = timing.nsPerOp
    const abide = timings[0] as (typeof timings)[number]

    let spread = false
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as ArmRow
        const timing = timings[i] as (typeof timings)[number]

        row.value.set(duration(bench.per === undefined ? timing.nsPerOp : timing.nsPerOp / bench.per.n))
        row.fill.set(slowest === 0 ? 0 : timing.nsPerOp / slowest)
        row.tail.set(row.floor ? 'subtract me' : row.subject ? 'baseline' : ratioText(abide.nsPerOp, timing.nsPerOp))
        row.tailVerdict.set(row.floor || row.subject ? '' : verdict(abide.nsPerOp, timing.nsPerOp))
        if (timing.spread > NOISY_SPREAD) spread = true
    }
    // A number nothing warns about is a number that gets quoted. The spread is a fact about the RUN —
    // something else on this page was competing — so the row says so rather than letting the minimum
    // stand in as though it were representative.
    noisy.set(spread)
}

async function runWork(bench: Extract<Bench, { kind: 'work' }>, rows: ArmRow[]): Promise<void> {
    for (let i = 0; i < bench.arms.length; i++) {
        const arm = bench.arms[i] as (typeof bench.arms)[number]
        const row = rows[i] as ArmRow
        await arm.prepare?.()
        await quiesce()
        row.of.set(nonZero(await measureFlush(arm.run)))
    }
}

/** `wake` and `budget` are the same arm shape: a count, and a name for what was counted. */
async function runCounted(bench: Extract<Bench, { kind: 'wake' | 'budget' }>, rows: ArmRow[]): Promise<void> {
    for (let i = 0; i < bench.arms.length; i++) {
        const arm = bench.arms[i] as (typeof bench.arms)[number]
        const row = rows[i] as ArmRow
        const { count, of } = await arm.run()
        row.value.set(String(count))
        row.of.set(of)
        await frame()
    }
}
