// The bench page: every case in the repo that carries a bench, as ONE table.
//
// There is no separate list of bench cases. A bench is a face of the case that already demonstrates
// and tests the same claim, so the claim on the row here is the case's own note — the three cannot
// drift into describing different things.
//
// A table rather than a stack of cards, because forty-odd benches are read by SCANNING. Every row on
// the page — case, arm, footnote — is laid on ONE column template, so a number sits directly under
// every other number of its kind and the eye runs down the page instead of re-entering each card's
// own little grid. The rows exist before anything runs: an unrun bench still says what it measures
// and against which hand-written arm, which is most of what a reader came for.
//
// The rules this page follows, from the project's own notes:
//
//   · a performance claim is a RATIO against hand-written code — absolute ms describe this machine
//   · a correctness test cannot guard "does less work", so work is COUNTED, not timed
//   · in a reactive system the contract is WAKE-UPS: count re-runs, not values
//   · a case earns its place by DISTINGUISHING implementations — a full reverse cannot tell a
//     minimal keyed reconcile from a rebuild; a two-row swap can

import {
    type Arm,
    type Bench,
    type BudgetBench,
    type Case,
    clockResolution,
    duration,
    FLOOR,
    frame,
    measureFlush,
    NOISY_SPREAD,
    nonZero,
    quiesce,
    ratioText,
    type TimeBench,
    timeArms,
    verdict,
    type WakeBench,
    type WorkBench,
} from 'abide/tests'
import { button, el, LABEL, SMALL_BUTTON } from '../demos/dom.ts'
import { benched } from '../demos/index.ts'
import { shell } from './page.ts'

const main = shell(
    'bench',
    'Every capability against a hand-written equivalent, one row per arm. Blue is abide; the last ' +
        'column is abide ÷ that arm. Time cases are best-of-many batches, so they are comparable ' +
        'within a run and meaningless between machines — read the ratio, not the number.',
    '/bench',
    'max-w-6xl',
)

// --- the one column template every row is laid on ----------------------------

const ROW = 'grid grid-cols-[minmax(0,1fr)_6.5rem_7rem_9.5rem] items-center gap-x-4 px-3'
// Every small-caps label on the page is this ramp plus a color, so the ramp is written once.
const HEAD = `${LABEL} text-slate-600`
const HEAD_RIGHT = `${HEAD} text-right`
const GROUP = `px-3 py-2 ${LABEL} text-slate-400 bg-slate-900/40`
const NUMBER = 'font-mono text-xs tabular-nums text-right'

// The kind is a chip rather than a column: it says how to read the rest of the row, and four colors
// are quicker to skip past than four words in the same grey.
const KIND: Record<Bench['kind'], string> = {
    time: `${LABEL} text-slate-500 shrink-0`,
    work: `${LABEL} text-emerald-500/80 shrink-0`,
    wake: `${LABEL} text-violet-400/80 shrink-0`,
    budget: `${LABEL} text-amber-500/80 shrink-0`,
}

const TAIL = 'text-xs text-right'

const COLOR: Record<ReturnType<typeof verdict>, string> = {
    faster: `text-emerald-400 ${TAIL}`,
    same: `text-emerald-400 ${TAIL}`,
    slower: `text-amber-400 ${TAIL}`,
}

const QUIET = `text-slate-600 ${TAIL}`

// --- the rows ---------------------------------------------------------------

interface TimeRow {
    value: HTMLElement
    fill: HTMLElement
    tail: HTMLElement
}

/** The grid row an arm is drawn on, already labelled and already in the table. */
function rowShell(host: HTMLElement, label: string, tone: string): HTMLElement {
    const node = el('div', `${ROW} py-1 hover:bg-slate-900/40`)
    node.append(el('span', `text-sm truncate ${tone}`, label, { title: label }))
    host.append(node)
    return node
}

function timeRow(host: HTMLElement, label: string, tone: string, bar: string): TimeRow {
    const node = rowShell(host, label, tone)
    const value = el('span', `${NUMBER} text-slate-200`, '—')
    const track = el('div', 'h-1.5 rounded bg-slate-900 overflow-hidden')
    const fill = el('div', `h-full ${bar}`)
    fill.style.width = '0%'
    track.append(fill)
    const tail = el('span', QUIET, '')
    node.append(value, track, tail)
    return { value, fill, tail }
}

/** `wake` and `budget` are both "a count, and a name for what was counted", so they draw the same. */
function countRow(host: HTMLElement, label: string, tone: string): { value: HTMLElement; of: HTMLElement } {
    const node = rowShell(host, label, tone)
    const value = el('span', `${NUMBER} text-emerald-300`, '—')
    const of = el('span', 'col-span-2 text-xs text-slate-500 truncate', '')
    node.append(value, of)
    return { value, of }
}

// The counters that moved, spanning the three number columns: a work arm's answer is a list of
// labelled counts, not one number, and squeezing it into the `per op` column would only lose it.
function workRow(host: HTMLElement, label: string, tone: string): HTMLElement {
    const counts = el('span', 'col-span-3 font-mono text-xs text-emerald-300 truncate', '—')
    rowShell(host, label, tone).append(counts)
    return counts
}

// --- one case ---------------------------------------------------------------

interface Built {
    title: string
    kind: Bench['kind']
    section: HTMLElement
    run: () => Promise<void>
}

function build(spec: Case, bench: Bench): Built {
    // A `<section>` rather than a div: one case is one region of the table, and it is what the page
    // test counts to prove every benched case reached the page.
    const section = el('section', 'py-1')
    const head = el('div', `${ROW} pt-2 pb-0.5`)
    const left = el('div', 'flex items-baseline gap-2 min-w-0')
    left.append(el('span', 'text-sm font-medium text-slate-100 truncate', spec.title, { title: spec.title }))
    left.append(el('span', KIND[bench.kind], bench.kind))
    head.append(left)

    const right = el('div', 'col-span-3 flex items-center justify-end gap-3')
    if (bench.kind === 'time' && bench.per !== undefined) {
        // The `per op` column would otherwise lie: these numbers are per row, not per op.
        right.append(el('span', HEAD, `per ${bench.per.label} · ${bench.per.n} per op`))
    }
    const status = el('span', HEAD, 'not run')
    right.append(
        status,
        button('run', () => void run(), SMALL_BUTTON),
    )
    head.append(right)
    section.append(head)

    if (spec.note !== undefined) {
        section.append(el('p', 'px-3 pb-1.5 text-xs text-slate-500 max-w-3xl', spec.note))
    }

    const body = el('div', 'pb-1')
    section.append(body)
    const footnote = el('p', 'hidden px-3 pt-1 text-xs text-amber-400')
    section.append(footnote)

    // The rows and the measurement that fills them are decided ONCE, here — the kind is a fact about
    // the case, not a question to re-ask on every run.
    let paint: () => Promise<void>
    let done: string
    if (bench.kind === 'time') {
        // The floor arm is measured WITH the others, interleaved, because a floor timed on its own
        // in a quiet moment is not the floor these arms actually paid.
        const arms: Arm[] = bench.floor === 'flush' ? [...bench.arms, FLOOR] : bench.arms
        const rows: TimeRow[] = []
        for (let i = 0; i < arms.length; i++) {
            const arm = arms[i] as Arm
            const floor = arm === FLOOR
            const tone = floor ? 'text-slate-500 italic' : i === 0 ? 'text-sky-300' : 'text-slate-300'
            const bar = floor ? 'bg-slate-700' : i === 0 ? 'bg-sky-500' : 'bg-slate-600'
            rows.push(timeRow(body, arm.label, tone, bar))
        }
        paint = () => runTime(bench, arms, rows, footnote)
        done = 'best of many batches'
    } else if (bench.kind === 'work') {
        const rows: HTMLElement[] = []
        for (let i = 0; i < bench.arms.length; i++) {
            const arm = bench.arms[i] as (typeof bench.arms)[number]
            rows.push(workRow(body, arm.label, i === 0 ? 'text-sky-300' : 'text-slate-300'))
        }
        paint = () => runWork(bench, rows)
        done = 'counted, not timed'
    } else {
        const rows: { value: HTMLElement; of: HTMLElement }[] = []
        for (let i = 0; i < bench.arms.length; i++) {
            const arm = bench.arms[i] as (typeof bench.arms)[number]
            rows.push(countRow(body, arm.label, i === 0 ? 'text-sky-300' : 'text-slate-300'))
        }
        paint = () => runCounted(bench, rows)
        done = 'counted, not timed'
    }

    async function run(): Promise<void> {
        status.textContent = 'running…'
        footnote.classList.add('hidden')
        await frame()
        await paint()
        status.textContent = done
    }

    return { title: spec.title, kind: bench.kind, section, run }
}

async function runTime(bench: TimeBench, arms: Arm[], rows: TimeRow[], footnote: HTMLElement): Promise<void> {
    const timings = await timeArms(arms, quiesce)
    let slowest = 0
    for (const timing of timings) if (timing.nsPerOp > slowest) slowest = timing.nsPerOp
    const abide = timings[0] as (typeof timings)[number]

    let noisy = false
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as TimeRow
        const timing = timings[i] as (typeof timings)[number]
        const floor = arms[i] === FLOOR

        row.value.textContent = duration(
            bench.per === undefined ? timing.nsPerOp : timing.nsPerOp / bench.per.n,
        )
        row.fill.style.width = `${Math.max(2, (timing.nsPerOp / slowest) * 100)}%`
        row.tail.textContent = floor
            ? 'subtract me'
            : i === 0
              ? 'baseline'
              : ratioText(abide.nsPerOp, timing.nsPerOp)
        row.tail.className = floor || i === 0 ? QUIET : COLOR[verdict(abide.nsPerOp, timing.nsPerOp)]
        if (timing.spread > NOISY_SPREAD) noisy = true
    }

    // A number nothing warns about is a number that gets quoted. The spread is a fact about the RUN —
    // something else on this page was competing — so the row says so rather than letting the minimum
    // stand in as though it were representative.
    footnote.textContent =
        'noisy: most passes were far off the best one. Re-run this case on its own before quoting the ratio.'
    footnote.classList.toggle('hidden', !noisy)
}

async function runWork(bench: WorkBench, rows: HTMLElement[]): Promise<void> {
    for (let i = 0; i < bench.arms.length; i++) {
        const arm = bench.arms[i] as (typeof bench.arms)[number]
        const cell = rows[i] as HTMLElement
        await arm.prepare?.()
        await quiesce()
        const counted = nonZero(await measureFlush(arm.run))
        cell.textContent = counted
        cell.title = counted
    }
}

async function runCounted(
    bench: WakeBench | BudgetBench,
    rows: { value: HTMLElement; of: HTMLElement }[],
): Promise<void> {
    for (let i = 0; i < bench.arms.length; i++) {
        const arm = bench.arms[i] as (typeof bench.arms)[number]
        const row = rows[i] as (typeof rows)[number]
        const { count, of } = await arm.run()
        row.value.textContent = String(count)
        row.of.textContent = of
        row.of.title = of
        await frame()
    }
}

// --- assembly ---------------------------------------------------------------

const toolbar = el('div', 'flex flex-wrap items-center gap-3')
main.append(toolbar)
main.append(
    el(
        'p',
        'text-xs text-slate-600',
        `This browser reports time in steps of ${clockResolution().toFixed(3)} ms; each batch is ` +
            'sized to take about 40 ms, so that clamp is the noise floor under every number below. ' +
            'A 1.05× difference is not a difference.',
    ),
)

const table = el('div', 'border-y border-slate-800 divide-y divide-slate-900')
main.append(table)

const columns = el('div', `${ROW} sticky top-12 z-[5] py-2 bg-slate-950/95 backdrop-blur`)
columns.append(el('span', HEAD, 'case · arm'))
columns.append(el('span', HEAD_RIGHT, 'per op'))
columns.append(el('span', HEAD, ''))
columns.append(el('span', HEAD_RIGHT, 'abide ÷ arm'))
table.append(columns)

interface Group {
    name: string
    node: HTMLElement
    cases: Built[]
}

const groups: Group[] = []
const built: Built[] = []
let group: Group | null = null
for (const entry of await benched()) {
    const spec = entry.suite.cases[entry.index] as Case
    if (group === null || entry.suite.name !== group.name) {
        const node = el('div', GROUP, entry.suite.name)
        table.append(node)
        group = { name: entry.suite.name, node, cases: [] }
        groups.push(group)
    }
    const made = build(spec, spec.bench as Bench)
    table.append(made.section)
    group.cases.push(made)
    built.push(made)
}

// --- the toolbar -------------------------------------------------------------

const progress = el('span', 'text-sm text-slate-500')
toolbar.append(
    button('run everything', async () => {
        const shown = built.filter((entry) => !entry.section.classList.contains('hidden'))
        for (let i = 0; i < shown.length; i++) {
            const entry = shown[i] as Built
            progress.textContent = `${i + 1} / ${shown.length} — ${entry.title}`
            await entry.run()
            // A case that allocated ten thousand nodes an op leaves a collection owed, and the next
            // one would otherwise pay it — which is how one hand-written arm reads 8.84 µs in a
            // whole-page run and 38.6 ns on its own. Waiting for the engine to go quiet is what makes
            // the two comparable.
            await quiesce()
        }
        progress.textContent = `done — ${shown.length} cases`
    }),
    progress,
)

// Filtering is part of scanning: the four kinds answer four different questions, and a reader after
// "what does abide allocate" has no use for the twenty-odd timing cases in between.
const FILTERS = ['all', 'time', 'work', 'wake', 'budget'] as const
const CHIP = 'rounded border px-2 py-0.5 text-xs border-slate-800 text-slate-500 hover:text-slate-300'
const CHIP_ON = 'rounded border px-2 py-0.5 text-xs border-sky-800 bg-sky-950 text-sky-300'

const filters = el('div', 'flex flex-wrap items-center gap-1.5 ml-auto')
const chips: { kind: (typeof FILTERS)[number]; node: HTMLElement }[] = []
let active: (typeof FILTERS)[number] = 'all'

function applyFilter(): void {
    for (const chip of chips) chip.node.className = chip.kind === active ? CHIP_ON : CHIP
    for (const entry of groups) {
        let shown = 0
        for (const made of entry.cases) {
            const show = active === 'all' || made.kind === active
            made.section.classList.toggle('hidden', !show)
            if (show) shown++
        }
        entry.node.textContent = `${entry.name} · ${shown}`
        entry.node.classList.toggle('hidden', shown === 0)
    }
}

for (const kind of FILTERS) {
    const node = button(
        kind,
        () => {
            active = kind
            applyFilter()
        },
        CHIP,
    )
    chips.push({ kind, node })
    filters.append(node)
}
toolbar.append(filters)
applyFilter()

// A last, non-timed observation: the machinery has to be justified by LOC as well as by speed.
main.append(
    el(
        'p',
        'pt-2 text-sm text-slate-500',
        'What the ratios do not show: the vanilla arms above are ~250 lines that each do one of these ' +
            'jobs and none of the others. The failure behaviour — a stale load landing on top of a ' +
            'newer one, a throwing effect stranding the batch, a status record waking every reader on ' +
            'every settle — is where the hand-written versions actually lose, and it is measured on ' +
            'this page as wakes and DOM calls rather than as time.',
    ),
)
