// The bench, as data: every benched case in the repo, with a cell per number the table shows.
//
// There is no separate list of bench cases. A bench is a face of the case that already demonstrates
// and tests the same claim, so the row's prose is the case's own note — the three cannot drift into
// describing different things.
//
// The split this file makes is between MEASURING and PAINTING. What comes out of `arm.run()` is a
// number; what the page does with it is a row in a grid. Keeping the two apart is what lets the table
// be an ordinary template over ordinary cells, and it is also what makes the measurement honest: the
// arms run against the same counters and the same clock whoever is asking, and nothing about the
// screen is in the loop that times them.
//
// The rules this obeys, from the project's own notes:
//
//   · a performance claim is a RATIO against hand-written code — absolute ms describe this machine
//   · a correctness test cannot guard "does less work", so work is COUNTED, not timed
//   · in a reactive system the contract is WAKE-UPS: count re-runs, not values
//   · a case earns its place by DISTINGUISHING implementations — a full reverse cannot tell a
//     minimal keyed reconcile from a rebuild; a two-row swap can

import { type State, state } from 'abide'
import {
    type Arm,
    type Bench,
    type Case,
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
} from 'abide/tests'
import { benched } from '../demos/index.ts'

/** One arm's row. One shape for all four kinds, so a row is never two different objects. */
export interface ArmRow {
    label: string
    /** abide is the first arm and is coloured as the subject; the flush floor is coloured as noise. */
    tone: string
    bar: string
    /** The number, however it is counted — a duration, or a count. `—` until it has been run. */
    value: State<string>
    /** How far the bar is filled, as a percentage string. Empty for a row that has no bar. */
    width: State<string>
    /** `baseline`, `subtract me`, or the ratio against abide. */
    tail: State<string>
    tailTone: State<string>
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

const SUBJECT = 'text-sky-300'
const OTHER = 'text-slate-300'
const FLOOR_TONE = 'text-slate-500 italic'

const TAIL = 'text-xs text-right'
const QUIET = `text-slate-600 ${TAIL}`
const TONE: Record<ReturnType<typeof verdict>, string> = {
    faster: `text-emerald-400 ${TAIL}`,
    same: `text-emerald-400 ${TAIL}`,
    slower: `text-amber-400 ${TAIL}`,
}

function armRow(label: string, tone: string, bar: string): ArmRow {
    return {
        label,
        tone,
        bar,
        value: state('—'),
        width: state('0%'),
        tail: state(''),
        tailTone: state(QUIET),
        of: state(''),
    }
}

/**
 * Every benched case, in suite order, with its rows already built.
 *
 * The rows exist BEFORE anything runs: an unrun bench still says what it measures and against which
 * hand-written arm, which is most of what a reader came for.
 */
export async function benchRows(): Promise<BenchRow[]> {
    const rows: BenchRow[] = []
    for (const entry of await benched()) {
        const spec = entry.suite.cases[entry.index] as Case
        rows.push(rowFor(entry.suite.name, spec, spec.bench as Bench))
    }
    return rows
}

function rowFor(suite: string, spec: Case, bench: Bench): BenchRow {
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
        arms = timed.map((arm, i) =>
            armRow(
                arm.label,
                arm === FLOOR ? FLOOR_TONE : i === 0 ? SUBJECT : OTHER,
                arm === FLOOR ? 'bg-slate-700' : i === 0 ? 'bg-sky-500' : 'bg-slate-600',
            ),
        )
        paint = () => runTime(bench, timed, arms, noisy)
        done = 'best of many batches'
    } else {
        arms = bench.arms.map((arm, i) => armRow(arm.label, i === 0 ? SUBJECT : OTHER, ''))
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
        const floor = timed[i] === FLOOR

        row.value.set(duration(bench.per === undefined ? timing.nsPerOp : timing.nsPerOp / bench.per.n))
        row.width.set(`${Math.max(2, (timing.nsPerOp / slowest) * 100)}%`)
        row.tail.set(floor ? 'subtract me' : i === 0 ? 'baseline' : ratioText(abide.nsPerOp, timing.nsPerOp))
        row.tailTone.set(floor || i === 0 ? QUIET : TONE[verdict(abide.nsPerOp, timing.nsPerOp)])
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
