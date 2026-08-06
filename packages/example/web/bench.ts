// The bench page: every case in the repo that carries a bench, grouped by the suite it belongs to.
//
// There is no separate list of bench cases. A bench is a face of the case that already demonstrates
// and tests the same claim, so the claim on the card here is the case's own note — the three cannot
// drift into describing different things.
//
// The rules this page follows, from the project's own notes:
//
//   · a performance claim is a RATIO against hand-written code — absolute ms describe this machine
//   · a correctness test cannot guard "does less work", so work is COUNTED, not timed
//   · in a reactive system the contract is WAKE-UPS: count re-runs, not values
//   · a case earns its place by DISTINGUISHING implementations — a full reverse cannot tell a
//     minimal keyed reconcile from a rebuild; a two-row swap can

import {
    type Bench,
    type BudgetBench,
    type Case,
    type Counts,
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
} from '$tests'
import { button, el, row } from '../demos/dom.ts'
import { benched } from '../demos/index.ts'
import { shell } from './page.ts'

const main = shell(
    'bench',
    'Every capability against a hand-written equivalent. Blue is abide; the ratio column is ' +
        'abide ÷ that arm. Time cases are best-of-many batches, so they are comparable within a run ' +
        'and meaningless between machines — read the ratio, not the number.',
    '/bench',
)

const controls = el('div', 'pb-2')
main.append(controls)
main.append(
    el(
        'p',
        'text-xs text-slate-600',
        `This browser reports time in steps of ${clockResolution().toFixed(3)} ms; each batch is ` +
            'sized to take about 40 ms, so that clamp is the noise floor under every number below. ' +
            'A 1.05× difference is not a difference.',
    ),
)

// --- one card ---------------------------------------------------------------

const HEAD = 'text-[10px] uppercase tracking-widest text-slate-600'
const RATIO_HEADER = `${HEAD} text-right`

function card(spec: Case, bench: Bench): { node: HTMLElement; run: () => Promise<void> } {
    const node = el('section', 'rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden')
    const head = el('div', 'px-5 pt-4 pb-3')
    const title = el('div', 'flex items-baseline justify-between gap-4')
    title.append(el('h3', 'text-base font-medium text-slate-100', spec.title))
    title.append(el('span', HEAD, bench.kind))
    head.append(title)
    if (spec.note !== undefined) head.append(el('p', 'mt-1 text-sm text-slate-400', spec.note))
    const body = el('div', 'px-5 pb-5 space-y-1.5')
    const status = el('p', 'px-5 pb-4 text-xs text-slate-600', 'not run')
    node.append(head, body, status)

    async function run(): Promise<void> {
        body.replaceChildren()
        status.textContent = 'running…'
        await frame()
        if (bench.kind === 'time') await runTime(bench, body)
        else if (bench.kind === 'work') await runWork(bench, body)
        else await runCounted(bench, body)
        status.textContent = bench.kind === 'time' ? 'best of many batches' : 'counted, not timed'
    }

    return { node, run }
}

async function runTime(bench: TimeBench, body: HTMLElement): Promise<void> {
    // The floor arm is measured WITH the others, interleaved, because a floor timed on its own in a
    // quiet moment is not the floor these arms actually paid.
    const arms = bench.floor === 'flush' ? [...bench.arms, FLOOR] : bench.arms
    const timings = await timeArms(arms, quiesce)
    const results = arms.map((arm, i) => ({ arm, ...(timings[i] as (typeof timings)[number]) }))
    const slowest = Math.max(...results.map((r) => r.nsPerOp))
    const abide = results[0] as (typeof results)[number]

    const heading = el('div', 'grid grid-cols-[1fr_7rem_1fr_7rem] items-center gap-3')
    heading.append(el('span', `${RATIO_HEADER} text-left`, 'arm'))
    heading.append(el('span', RATIO_HEADER, bench.per === undefined ? 'per op' : `per ${bench.per.label}`))
    heading.append(el('span', ''))
    heading.append(el('span', RATIO_HEADER, 'abide vs this'))
    body.append(heading)

    let noisy = false
    for (const result of results) {
        const isFloor = result.arm === FLOOR
        const line = el('div', 'grid grid-cols-[1fr_7rem_1fr_7rem] items-center gap-3 text-sm')
        const tone = isFloor ? 'text-slate-500 italic' : result === abide ? 'text-sky-300' : 'text-slate-300'
        line.append(el('span', tone, result.arm.label))

        const time =
            bench.per === undefined ? duration(result.nsPerOp) : duration(result.nsPerOp / bench.per.n)
        line.append(el('span', 'font-mono text-xs text-slate-200 text-right tabular-nums', time))

        const track = el('div', 'h-2 rounded bg-slate-800 overflow-hidden')
        const fill = el(
            'div',
            isFloor ? 'h-full bg-slate-700' : result === abide ? 'h-full bg-sky-500' : 'h-full bg-slate-600',
        )
        fill.style.width = `${Math.max(2, (result.nsPerOp / slowest) * 100)}%`
        track.append(fill)
        line.append(track)

        if (result.spread > NOISY_SPREAD) noisy = true
        line.append(
            el(
                'span',
                `text-xs text-right ${result === abide || isFloor ? 'text-slate-600' : COLOUR[verdict(abide.nsPerOp, result.nsPerOp)]}`,
                isFloor
                    ? 'subtract me'
                    : result === abide
                      ? 'baseline'
                      : ratioText(abide.nsPerOp, result.nsPerOp),
            ),
        )
        body.append(line)
    }
    if (bench.per !== undefined) {
        body.append(el('p', 'pt-1 text-xs text-slate-600', `per ${bench.per.label} · ${bench.per.n} per op`))
    }
    if (noisy) {
        // A number nothing warns about is a number that gets quoted. The spread is a fact about the
        // RUN — something else on this page was competing — so the card says so rather than letting
        // the minimum stand in as though it were representative.
        body.append(
            el(
                'p',
                'pt-1 text-xs text-amber-400',
                'noisy: most passes were far off the best one. Re-run this card on its own before ' +
                    'quoting the ratio.',
            ),
        )
    }
}

const COLOUR: Record<ReturnType<typeof verdict>, string> = {
    faster: 'text-emerald-400',
    same: 'text-emerald-400',
    slower: 'text-amber-400',
}

async function runWork(bench: WorkBench, body: HTMLElement): Promise<void> {
    const results: { label: string; counts: Counts }[] = []
    for (const arm of bench.arms) {
        await arm.prepare?.()
        await quiesce()
        results.push({ label: arm.label, counts: await measureFlush(arm.run) })
    }
    for (let i = 0; i < results.length; i++) {
        const result = results[i] as (typeof results)[number]
        const line = el('div', 'grid grid-cols-[1fr_2fr] items-baseline gap-3 text-sm')
        line.append(el('span', i === 0 ? 'text-sky-300' : 'text-slate-300', result.label))
        line.append(el('span', 'font-mono text-xs text-emerald-300', nonZero(result.counts)))
        body.append(line)
    }
}

// `wake` and `budget` report the same thing — a count, and a name for what was counted — so they
// are drawn the same way. What differs is the claim, which is the case's own note.
async function runCounted(bench: WakeBench | BudgetBench, body: HTMLElement): Promise<void> {
    for (let i = 0; i < bench.arms.length; i++) {
        const arm = bench.arms[i] as (typeof bench.arms)[number]
        const { count, of } = await arm.run()
        const line = el('div', 'grid grid-cols-[1fr_2fr] items-baseline gap-3 text-sm')
        line.append(el('span', i === 0 ? 'text-sky-300' : 'text-slate-300', arm.label))
        line.append(el('span', 'font-mono text-xs text-emerald-300', `${count} ${of}`))
        body.append(line)
        await frame()
    }
}

// --- assembly ---------------------------------------------------------------

const built: { name: string; run: () => Promise<void> }[] = []
let group = ''
for (const entry of await benched()) {
    const spec = entry.suite.cases[entry.index] as Case
    if (entry.suite.name !== group) {
        group = entry.suite.name
        main.append(
            el(
                'h2',
                'pt-6 text-xs uppercase tracking-widest text-slate-500 border-b border-slate-800 pb-2',
                group,
            ),
        )
    }
    const made = card(spec, spec.bench as Bench)
    const wrap = el('div', 'space-y-2')
    const single = el('div', 'flex justify-end')
    single.append(button('run', () => void made.run()))
    wrap.append(made.node, single)
    main.append(wrap)
    built.push({ name: spec.title, run: made.run })
}

const progress = el('span', 'text-sm text-slate-500')
controls.append(
    row(
        button('run everything', async () => {
            for (let i = 0; i < built.length; i++) {
                const entry = built[i] as (typeof built)[number]
                progress.textContent = `${i + 1} / ${built.length} — ${entry.name}`
                await entry.run()
                // A card that allocated ten thousand nodes an op leaves a collection owed, and the
                // next card used to pay it — which is how one hand-written arm read 8.84 µs here and
                // 38.6 ns on its own. Waiting for the engine to go quiet is what makes a whole-page
                // run comparable with a single-card one.
                await quiesce()
            }
            progress.textContent = `done — ${built.length} cases`
        }),
        progress,
    ),
)

// A last, non-timed observation: the machinery has to be justified by LOC as well as by speed.
main.append(
    el(
        'p',
        'pt-8 text-sm text-slate-500',
        'What the ratios do not show: the vanilla arms above are ~250 lines that each do one of these ' +
            'jobs and none of the others. The failure behaviour — a stale load landing on top of a ' +
            'newer one, a throwing effect stranding the batch, a status record waking every reader on ' +
            'every settle — is where the hand-written versions actually lose, and it is measured on ' +
            'this page as wakes and DOM calls rather than as time.',
    ),
)
