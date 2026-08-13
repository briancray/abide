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
import { isThenable } from './probes.ts'
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
    total,
    verdict,
} from '../measure.ts'

/** One arm's row. One shape for all four kinds, so a row is never two different objects. */
export interface ArmRow {
    label: string
    /** The FIRST arm, which is always abide — the subject the ratio is phrased from. */
    subject: boolean
    /** The harness floor: a measurement of measuring, to be subtracted rather than compared. */
    floor: boolean
    /**
     * The number, however it is counted — a duration, or a count. `—` until it has been run.
     *
     * For a time bench this is the WHOLE op: what somebody actually waits on, and the only number a
     * frame budget can be read against. It used to be the per-item number whenever a bench declared
     * `per`, which left the page unable to say whether an op crossed 16 ms — a card reading `4.20 µs`
     * is either invisible or a dropped frame depending on an `n` printed elsewhere.
     */
    value: State<string>
    /**
     * The same duration divided down: `4.20 µs/row`. Empty for a bench with no `per`.
     *
     * The two answer different questions and neither replaces the other — the whole op says whether a
     * user notices, the per-item number is what stays comparable when `n` changes.
     */
    each: State<string>
    /**
     * The rest of the pass distribution, and what one op ALLOCATED. Empty for a bench that is counted
     * rather than timed.
     *
     * `value` is the minimum, which is the right number for a ratio and the wrong one on its own: a
     * reader cannot tell a quiet machine from a fluke without seeing where the other passes landed.
     * `nodes` is the memory-shaped number and it is a COUNT of nodes made per op, not bytes — see
     * `Timing.nodes` for why no page can honestly report the other thing.
     */
    p50: State<string>
    p90: State<string>
    max: State<string>
    nodes: State<string>
    /** 0 to 1, against the slowest arm in the row. Whether that becomes a bar is the page's business. */
    fill: State<number>
    /** `baseline`, `subtract me`, or the ratio against abide. */
    tail: State<string>
    /** Which way that ratio went, for a page to colour. Empty for a row that is not a comparison. */
    tailVerdict: State<'faster' | 'same' | 'slower' | ''>
    /** What was counted, for a wake or a budget arm; the counters that moved, for a work arm. */
    of: State<string>
}

/**
 * One measured THING, as the four numbers a reader is actually comparing: what it is, what abide
 * costs, what the hand-written arm costs, and the difference.
 *
 * The arms are still all here — `rest` holds every one that is not those two — but they are no longer
 * the page's top level, and that is the whole point. Forty benches at six arms each is 240 lines of
 * equal weight, and the two numbers anybody came for are buried in it: a page like that is read by
 * hunting rather than by scanning. So the LINE is the claim and the arms are the evidence behind it.
 */
export interface BenchRow {
    suite: string
    title: string
    note: string
    kind: Bench['kind']
    /** What one op IS — `500 slots per op` — so the whole-op number can be read. Empty otherwise. */
    per: string
    status: State<string>
    /** A run whose passes were far apart. The minimum is then not representative, and the row says so. */
    noisy: State<boolean>
    /** The subject — always the first arm, by the rule every bench in this repo is written to. */
    abide: ArmRow
    /**
     * The hand-written arm, found by its `vanilla — ` label.
     *
     * By CONVENTION rather than by declaration, and that is a trade taken deliberately: every bench in
     * the repo already names its arms this way, and the alternative is a field on `Arm` that ninety
     * labels would have to repeat. `null` where a bench has no hand-written arm at all — several
     * compare two abide spellings against each other, and a table that invented a comparison for
     * those would be reporting one that was never made.
     */
    handWritten: ArmRow | null
    /** Every other arm: variants, alternatives, the harness floor. Behind the disclosure. */
    rest: ArmRow[]
    arms: ArmRow[]
    run: () => Promise<void>
    /**
     * Run ONE arm, `ops` times, untimed — the seam an out-of-process profiler brackets its own reads
     * with.
     *
     * Deliberately not `run()` and deliberately not interleaved. `run()` is a timing measurement and
     * its interleaving is load-bearing; a forced collection dropped between its passes would wreck
     * the thing it exists to take. What a profiler wants is the opposite: one arm, alone, long
     * enough to move a counter, with no clock involved at all — so the two lanes measure the same
     * arms and share nothing that could make one distort the other.
     */
    profile: (label: string, ops: number) => Promise<void>
}

/** The label every hand-written arm in this repo starts with. See `BenchRow.handWritten`. */
const HAND_WRITTEN = 'vanilla'

/**
 * What all four kinds of arm have in common, which is all `profile` needs of them.
 *
 * A `time` arm takes an index and a `wake` arm answers with a count; neither matters to a profiler,
 * which is not reading what the arm RETURNS. It is reading what the engine looks like on either side
 * of it, so the only thing it needs is the ability to run the thing and wait for it.
 */
interface Runnable {
    label: string
    prepare?: () => void | Promise<void>
    run: (i: number) => unknown
}

async function profileArm(arms: Runnable[], label: string, ops: number): Promise<void> {
    const arm = arms.find((candidate) => candidate.label === label)
    if (arm === undefined) throw new Error(`abide-kit: no arm named ${JSON.stringify(label)}`)
    await arm.prepare?.()
    // Warmed before the caller's first read, for the reason every other measurement here warms: a
    // parse, a first-call cache and a cold call site are one-time costs, and a profiler bracketing
    // twenty ops would otherwise attribute all three to the twenty.
    const produced = arm.run(0)
    if (isThenable(produced)) await produced
    for (let i = 0; i < ops; i++) {
        const each = arm.run(i + 1)
        if (isThenable(each)) await each
    }
}

function armRow(label: string, subject: boolean, floor: boolean): ArmRow {
    return {
        label,
        subject,
        floor,
        value: state('—'),
        each: state(''),
        p50: state(''),
        p90: state(''),
        max: state(''),
        nodes: state(''),
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
/**
 * The handle an out-of-process profiler reaches the arms through.
 *
 * A GLOBAL, which is the only shape that works: the driver is a `page.evaluate` on the other side of
 * a bundle, so it can reach what the page hangs on `window` and nothing else. It is a read of the
 * same rows the page is drawing rather than a second set — a profiler measuring arms nobody can see
 * on the page would be measuring a different program.
 *
 * The whole surface is two calls, `list` and `run`, and both are `structuredClone`-able across the
 * protocol boundary: a `BenchRow` holds cells and closures and none of that survives the trip, so
 * what crosses is the names.
 */
export function exposeBench(rows: BenchRow[]): void {
    const held = globalThis as { abideBench?: unknown }
    held.abideBench = {
        list: (): { suite: string; title: string; kind: string; arms: string[] }[] =>
            rows.map((row) => ({
                suite: row.suite,
                title: row.title,
                kind: row.kind,
                arms: row.arms.map((arm) => arm.label),
            })),
        run: async (title: string, label: string, ops: number): Promise<void> => {
            const row = rows.find((candidate) => candidate.title === title)
            if (row === undefined) throw new Error(`abide-kit: no bench named ${JSON.stringify(title)}`)
            await row.profile(label, ops)
        },
    }
}

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
    // The RAW arms, kept beside the rows they became: `profile` runs one of them and a row cannot,
    // because a row holds the numbers rather than the work that produced them.
    let raw: Runnable[]

    if (bench.kind === 'time') {
        // The floor arm is measured WITH the others, interleaved, because a floor timed on its own in
        // a quiet moment is not the floor these arms actually paid.
        const timed: Arm[] = bench.floor === 'flush' ? [...bench.arms, FLOOR] : bench.arms
        arms = timed.map((arm, i) => armRow(arm.label, arm !== FLOOR && i === 0, arm === FLOOR))
        raw = timed
        paint = () => runTime(bench, timed, arms, noisy)
        done = 'best of many batches'
    } else {
        arms = bench.arms.map((arm, i) => armRow(arm.label, i === 0, false))
        raw = bench.arms
        paint = bench.kind === 'work' ? () => runWork(bench, arms) : () => runCounted(bench, arms)
        done = 'counted, not timed'
    }

    // The line the page reads, and the arms behind it. One pass rather than three filters: this runs
    // once per benched case at import, and a reader following it should not have to hold three
    // predicates in their head to know which arm ended up where.
    const abide = arms[0] as ArmRow
    let handWritten: ArmRow | null = null
    const rest: ArmRow[] = []
    for (let i = 1; i < arms.length; i++) {
        const arm = arms[i] as ArmRow
        if (handWritten === null && arm.label.startsWith(HAND_WRITTEN)) handWritten = arm
        else rest.push(arm)
    }

    return {
        suite,
        title: spec.title,
        note: spec.note ?? '',
        kind: bench.kind,
        per:
            bench.kind === 'time' && bench.per !== undefined
                ? `${bench.per.n} ${bench.per.label}s per op`
                : '',
        status,
        noisy,
        abide,
        handWritten,
        rest,
        arms,
        profile: (label, ops) => profileArm(raw, label, ops),
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

        row.value.set(duration(timing.nsPerOp))
        row.each.set(
            bench.per === undefined ? '' : `${duration(timing.nsPerOp / bench.per.n)}/${bench.per.label}`,
        )
        row.p50.set(duration(timing.p50))
        row.p90.set(duration(timing.p90))
        row.max.set(duration(timing.max))
        row.nodes.set(timing.nodes.toLocaleString())
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

/**
 * Fill the diff column of every arm but the subject, from counts the run has already taken.
 *
 * `ratioText` for the number — one axis on the page, whatever is being divided — but NOT `verdict`,
 * because a counter has no noise floor. Two timings 3% apart are the same measurement taken twice;
 * three wake-ups against four is one extra wake-up, every time, and a 5% band that called it `same`
 * would be hiding exactly the kind of regression a wake bench exists to catch.
 */
function countTails(rows: ArmRow[], counts: number[]): void {
    const subject = counts[0] as number
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i] as ArmRow
        const count = counts[i] as number
        row.tail.set(ratioText(subject, count))
        row.tailVerdict.set(subject === count ? 'same' : subject < count ? 'faster' : 'slower')
    }
    ;(rows[0] as ArmRow).tail.set('baseline')
}

async function runWork(bench: Extract<Bench, { kind: 'work' }>, rows: ArmRow[]): Promise<void> {
    const counts: number[] = []
    for (let i = 0; i < bench.arms.length; i++) {
        const arm = bench.arms[i] as (typeof bench.arms)[number]
        const row = rows[i] as ArmRow
        await arm.prepare?.()
        await quiesce()
        const measured = await measureFlush(arm.run)
        // How much the region CHANGED the document, which is the headline a work bench is making a
        // claim about; `of` keeps the breakdown for the reader who opens the row.
        counts.push(total(measured))
        row.value.set(String(total(measured)))
        row.of.set(nonZero(measured))
    }
    countTails(rows, counts)
}

/** `wake` and `budget` are the same arm shape: a count, and a name for what was counted. */
async function runCounted(bench: Extract<Bench, { kind: 'wake' | 'budget' }>, rows: ArmRow[]): Promise<void> {
    const counts: number[] = []
    for (let i = 0; i < bench.arms.length; i++) {
        const arm = bench.arms[i] as (typeof bench.arms)[number]
        const row = rows[i] as ArmRow
        const { count, of } = await arm.run()
        counts.push(count)
        row.value.set(String(count))
        row.of.set(of)
        await frame()
    }
    countTails(rows, counts)
}
