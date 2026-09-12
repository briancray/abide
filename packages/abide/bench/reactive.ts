// THE PER-OPERATION RATIO, against hand-written code doing the same job. The example
// cards price a whole rendered page; this prices a read, a write, a wake and a
// recompute — the four things the reactive core actually is, where a regression shows
// up as a number rather than as 0.4% of somebody's click-to-paint.
//
// CLAUDE.md: a performance claim is a RATIO against hand-written code in the same
// substrate, and absolute ms describe the machine. So every case below carries both
// arms, `batch()` interleaves them (44.8), and what is reported is the quotient and
// the measured A/A floor it has to clear.
//
// IT RUNS UNDER `bun run bench:reactive`, NOT IN THE GATE, and that is three refusals
// rather than a preference: `batch()` throws in a parallel worker (44.18), throws on a
// sample under 100x the clock's measured resolution (44.11), and throws on a duration
// whose op touched an emulated DOM (44.12) — and `bunfig.toml` preloads happy-dom into
// every `bun test` process.
//
// AN ARM YOU WROTE YOURSELF GETS MORE OF THIS, NOT LESS. Three arms here have
// measured nothing at some point — a discarded result, a `void`, and a branch on a
// constant — and each read as a plausible small number rather than as an error. The
// rule that catches it is the clock: under one nanosecond is under one cycle at
// 3 GHz, so any arm reporting less than about 0.5 ns has been deleted. Every read
// below accumulates into `sink`, and anything a compiler could prove constant is
// initialised from something it cannot.
//
// WHERE THE HAND ARM COMES FROM. `harness/measure/vanilla` is the floor every reactive
// ratio is against and it is deliberately `let value; const subscribers = []` — "the
// moment it grows a dependency graph it stops being the floor the machinery is
// budgeted against". So the cases it covers use it, and the three that need more than
// a signal — a derived value, a probe, a mutated array — carry the smallest hand
// arm that does THAT job, written beside the case. Growing `signal.ts` to serve them
// would be writing abide twice and calling the second one the baseline.

import { signal } from 'harness/measure/vanilla'
import { batch, ratio } from 'harness/report'
import { memo, state, watch } from '#shared/index.ts'
// REACHED DIRECTLY, not through the barrel: the framework's own entry points are not
// public surface, and what the panel shows for the abide arm is the method the op
// calls. `revalidate` is the collaborator that makes a memo read interesting.
// `flushEffects` because 12.12 has a write SCHEDULE its readers: an arm that stopped at
// the write would be timing an enqueue against the hand arm's actual wake, which is the
// work-disagreement `ratio()` refuses — and here it would have been declared rather than
// measured, so nothing would have caught it.
import {
    flushEffects,
    revalidate,
    subscribe,
} from '#shared/reactive/graph.ts'
import { ReactiveNode } from '#shared/reactive/ReactiveNode.ts'

// `private` in TypeScript is a compile-time word, so every one of these is on the
// prototype at run time. The cast says that out loud rather than widening the class.
const NODE = ReactiveNode.prototype as unknown as Record<
    string,
    (...args: never[]) => unknown
>

const leans = {
    read: { name: 'ReactiveNode.read', fn: NODE.read as never },
    peek: { name: 'ReactiveNode.peek', fn: NODE.peek as never },
    produce: { name: 'ReactiveNode.produce', fn: NODE.produce as never },
    enter: { name: 'ReactiveNode.enter', fn: NODE.enter as never },
    patch: { name: 'ReactiveNode.patch', fn: NODE.patch as never },
    pending: { name: 'ReactiveNode.pending', fn: NODE.pending as never },
    recompute: { name: 'ReactiveNode.recompute', fn: NODE.recompute as never },
    subscribe: { name: 'subscribe', fn: subscribe as never },
    revalidate: { name: 'revalidate', fn: revalidate as never },
}

// Every case is the same shape: two arms doing one op, and the work each did, counted
// in a pass of its own. `ratio()` refuses a comparison whose arms disagree on work by
// more than 5% — byte-identical page source ran 4.5x apart because one arm was not
// doing the job — and on an op this small that check is most of the value.
type Case = {
    name: string
    abide: () => void
    hand: () => void
    work?: { abide: Record<string, number>; hand: Record<string, number> }
    // WHAT EACH ARM LEANS ON, where the op body hides it. `sink += hand.read()`
    // says nothing about what `hand` IS, and `sink += handDoubled()` beside
    // `sink += doubled()` reads as parity when one of the two is a dirty flag and the
    // other is a reactive graph — so the comparison is not fair until the thing being
    // compared is on the page. A function, not a string, so it cannot drift from what
    // ran: for the four cases over a signal this is `signal` itself, which is the
    // whole hand-written arm.
    handHelpers?: Leaning[]
    // AND THE SAME FOR ABIDE, WHICH IS NOT SYMMETRIC AND SHOULD NOT PRETEND TO BE.
    // The hand arm's mechanism is twenty lines and fits on the row; abide's is 1331,
    // so what goes here is the ENTRY POINT the op calls plus at most one collaborator
    // where that is the interesting half. It is a chosen path, not a trace — the set
    // can be wrong about what an op walks in a way the source of each entry cannot be
    // wrong about itself. The asymmetry between the two columns IS what the ratio
    // measures, and a reader should see it rather than infer it.
    abideHelpers?: Leaning[]
}

type Leaning = { name: string; fn: (...args: never[]) => unknown }

const ROWS = 500

// A RESULT NOTHING READS IS A RESULT THE COMPILER CAN DELETE. Every read arm below
// accumulates into this, in both arms, so neither is measuring how well JSC saw
// through it. The first spelling discarded both and the probe's hand arm was a bare
// `void` — 2.0 ns for a load that had been eliminated.
let sink = 0

export function sunk(): number {
    return sink
}

function cases(): Case[] {
    const built: Case[] = []

    // ----- the floor ------------------------------------------------------------
    // EVERY ROW BELOW CARRIES THIS, so it is on the page rather than subtracted in
    // silence. Both arms are the same code, so it reports ~1.00x, and the absolute
    // number is what the batcher's own loop costs: one call into the arm plus the
    // accumulate that keeps the result observable. Measured apart: an empty arm is
    // 0.55 ns and one accumulate is 0.83 ns, so the accumulate itself is ~0.28 ns.
    //
    // It matters for the CHEAP rows and not the dear ones. A constant added to both
    // sides of a quotient pulls it toward 1, so a 5.7-against-2.5 read is really
    // nearer 4.9-against-1.7 — the table understates abide's cost on a read and is
    // accurate to a fraction of a percent on a write.
    //
    // And `+=` is not dearer than `=`: measured, `sink += 1` and `sink = sink + 1`
    // are both 0.827 ns. JSC compiles them to the same load, add and store.
    built.push({
        name: 'the measurement floor, both arms identical',
        abide: () => {
            sink += 1
        },
        hand: () => {
            sink += 1
        },
    })

    // ----- a read ---------------------------------------------------------------
    {
        const held = state(1)
        const hand = signal(1)
        built.push({
            name: 'read a settled value',
            abideHelpers: [leans.read, leans.subscribe],
            handHelpers: [{ name: 'signal', fn: signal }],
            abide: () => {
                sink += held() as number
            },
            hand: () => {
                sink += hand.read()
            },
        })
        built.push({
            name: 'read without joining the flow',
            abideHelpers: [leans.peek],
            handHelpers: [{ name: 'signal', fn: signal }],
            abide: () => {
                sink += held.peek() as number
            },
            hand: () => {
                sink += hand.read()
            },
        })
    }

    // ----- a write nobody is listening to ---------------------------------------
    {
        const held = state(0)
        const hand = signal(0)
        let at = 0
        built.push({
            name: 'write, nothing subscribed',
            abideHelpers: [leans.produce, leans.enter],
            handHelpers: [{ name: 'signal', fn: signal }],
            abide: () => {
                at += 1
                held.set(at)
            },
            hand: () => {
                at += 1
                hand.write(at)
            },
            work: { abide: { wakes: 0 }, hand: { wakes: 0 } },
        })
    }

    // ----- a write one reader wakes on ------------------------------------------
    {
        const held = state(0)
        const hand = signal(0)
        let abideRuns = 0
        let handRuns = 0
        watch(() => {
            sink += held() as number
            abideRuns += 1
        })
        // THE HAND SUBSCRIBER READS TOO. A signal PUSHES the value to its subscriber
        // and abide's reader PULLS it — 5.1 needs the pull, to compare identity — so
        // an arm whose subscriber only counted was doing less work than the one it
        // was the baseline for.
        hand.subscribe(() => {
            sink += hand.read()
            handRuns += 1
        })
        let at = 0
        built.push({
            name: 'write, one reader wakes',
            abideHelpers: [leans.produce, leans.enter],
            handHelpers: [{ name: 'signal', fn: signal }],
            abide: () => {
                at += 1
                held.set(at)
                flushEffects()
            },
            hand: () => {
                at += 1
                hand.write(at)
            },
            // ONE WAKE EACH, asserted rather than assumed. An abide write that woke
            // nobody would be the faster arm and the wrong one — which is what this
            // arm became when 12.12 landed, until the drain was put in it.
            work: { abide: { wakes: 1 }, hand: { wakes: 1 } },
        })
        built.push({
            name: 'write of an equal value',
            abideHelpers: [leans.produce],
            handHelpers: [{ name: 'signal', fn: signal }],
            abide: () => {
                held.set(at)
            },
            hand: () => {
                hand.write(at)
            },
            // 5.2 on one side, `next === value` on the other. Neither wakes.
            work: { abide: { wakes: 0 }, hand: { wakes: 0 } },
        })
        void abideRuns
        void handRuns
    }

    // ----- a derived value ------------------------------------------------------
    // The hand arm is recompute-on-read behind a dirty flag, which is what somebody
    // writes when they want a derived value and nothing else. It has no identity
    // check, no propagation and no subscriber list — so this ratio is the price of
    // those, stated.
    {
        const source = state(1)
        const doubled = memo(() => (source() as number) * 2)
        let handSource = 1
        let handValue = 2
        let handDirty = false
        const handDoubled = () => {
            if (handDirty) {
                handValue = handSource * 2
                handDirty = false
            }
            return handValue
        }
        doubled()
        built.push({
            name: 'read a derived value, unchanged',
            abideHelpers: [leans.read, leans.revalidate],
            handHelpers: [{ name: 'handDoubled', fn: handDoubled }],
            abide: () => {
                sink += doubled() as number
            },
            hand: () => {
                sink += handDoubled()
            },
        })
        let at = 1
        built.push({
            name: 'write, then read the value derived from it',
            abideHelpers: [leans.produce, leans.recompute],
            handHelpers: [{ name: 'handDoubled', fn: handDoubled }],
            abide: () => {
                at += 1
                source.set(at)
                sink += doubled() as number
            },
            hand: () => {
                at += 1
                handSource = at
                handDirty = true
                sink += handDoubled()
            },
        })
    }

    // ----- a probe --------------------------------------------------------------
    // TWO VALUES, ALTERNATING, and that is not decoration. A single hand-written
    // boolean is LOOP-INVARIANT: the batcher's loop reads the same field every
    // iteration, JSC hoists the load out and the arm came back at 0.37 ns — under one
    // cycle at 3 GHz. abide's probe is a call that subscribes, so it cannot be
    // hoisted, and comparing the two was comparing a load against nothing. Both arms
    // now select between two values per operation and both pay the load.
    //
    // The hand arm is a field on an object, which IS what a probe is when nothing
    // propagates it. The gap is what 11.20 and 11.22 cost.
    {
        const first = state(1)
        const second = state(2)
        const handFirst = { pending: Math.random() < 0 }
        const handSecond = { pending: Math.random() < 0 }
        let at = 0
        built.push({
            name: 'read a probe',
            abideHelpers: [leans.pending],
            abide: () => {
                at += 1
                if ((at & 1 ? first : second).pending()) sink += 1
            },
            hand: () => {
                at += 1
                if ((at & 1 ? handFirst : handSecond).pending) sink += 1
            },
        })
    }

    // ----- a mutation of a large value ------------------------------------------
    {
        const rows = state(Array.from({ length: ROWS }, (_, at) => at))
        const handRows = Array.from({ length: ROWS }, (_, at) => at)
        const handReaders: (() => void)[] = []
        let abideRuns = 0
        let handRuns = 0
        watch(() => {
            sink += (rows() as number[])[0] as number
            abideRuns += 1
        })
        handReaders.push(() => {
            sink += handRows[0] as number
            handRuns += 1
        })
        let at = 0
        built.push({
            name: `patch one element of ${ROWS}, one reader wakes`,
            abideHelpers: [leans.patch],
            abide: () => {
                at += 1
                rows.patch((held) => {
                    ;(held as number[])[0] = at
                })
                flushEffects()
            },
            hand: () => {
                at += 1
                handRows[0] = at
                for (const reader of handReaders) reader()
            },
            work: { abide: { wakes: 1 }, hand: { wakes: 1 } },
        })
        void abideRuns
        void handRuns
    }

    return built
}

// THE LIST WITHOUT THE RUN, so the status page can draw every operation as a row
// before anything is timed — and so that adding a case to `cases()` shows up in the
// table rather than only in a result nobody has asked for yet. Asked of the CHILD
// rather than imported: this module builds live reactive graphs at call time, and a
// server that wants nine strings should not be holding them.
export function caseNames(): string[] {
    return cases().map((one) => one.name)
}

// THE SOURCE OF WHAT RAN, off the function itself. A pair of strings written beside
// each case would be a second copy that drifts the first time an arm is edited, and
// the one thing a reader wants from a ratio is to see both arms — so this is
// `toString()` on the arm that was timed, with the arrow wrapper taken off and the
// body dedented. Bun hands back the post-transform source, so what shows is what the
// engine ran rather than what the file says.
function dedent(source: string): string {
    const lines = source.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length === 0) return ''
    // The FIRST line carries no indentation of its own — it starts where the opening
    // brace was — so the common prefix is measured over the rest and the first is
    // trimmed. Measured over all of them, the minimum is always zero and nothing
    // dedents: a helper nested three scopes deep rendered with six spaces of lead.
    const rest = lines.slice(1)
    const indent = rest.length
        ? Math.min(...rest.map((line) => line.length - line.trimStart().length))
        : 0
    return [
        lines[0]?.trim() ?? '',
        ...rest.map((line) => line.slice(indent)),
    ].join('\n')
}

function leaningOf(
    on: Leaning[] | undefined,
): { name: string; source: string }[] {
    return (on ?? []).map((one) => ({
        name: one.name,
        source: dedent(one.fn.toString()),
    }))
}

function bodyOf(arm: () => void): string {
    const source = arm.toString()
    const block = /^\(\)\s*=>\s*\{([\s\S]*)\}\s*$/.exec(source)
    return dedent(
        block ? (block[1] ?? '') : source.replace(/^\(\)\s*=>\s*/, ''),
    )
}

export type ReactiveBenchRow = {
    case: string
    n: number
    reps: number
    floor: number
    abideNanoseconds: number
    handNanoseconds: number
    abideP95: number
    handP95: number
    ratio: { kind: string; value: number | null; floor: number | null }
    workDisagreement: string[]
    // What each arm IS, side by side. The two are the whole of the comparison.
    abideSource: string
    handSource: string
    // What each arm leans on, where the case names any.
    abideLeaning: { name: string; source: string }[]
    handLeaning: { name: string; source: string }[]
}

// `onRow` rather than a return alone: one case is a second or two and the whole set
// is a dozen, so the status page fills a row at a time rather than waiting for the
// table. The array still comes back, for the command line.
export function benchReactive(
    onRow?: (row: ReactiveBenchRow, done: number, total: number) => void,
): ReactiveBenchRow[] {
    const rows: ReactiveBenchRow[] = []
    const all = cases()
    for (const one of all) {
        const batched = batch({
            case: one.name,
            emulated: null,
            arms: { abide: one.abide, 'hand-written': one.hand },
            ...(one.work
                ? {
                      work: {
                          abide: one.work.abide,
                          'hand-written': one.work.hand,
                      },
                  }
                : {}),
        })
        const abide = batched.samples.abide
        const hand = batched.samples['hand-written']
        if (!abide || !hand)
            throw new Error(`both arms have to produce a sample: ${one.name}`)
        const against = ratio(abide, hand, { floor: batched.floor })
        rows.push({
            case: one.name,
            n: batched.n,
            reps: batched.reps,
            floor: batched.floor,
            abideNanoseconds: abide.nanoseconds,
            handNanoseconds: hand.nanoseconds,
            abideP95: abide.p95,
            handP95: hand.p95,
            ratio: {
                kind: against.kind,
                value: against.kind === 'ratio' ? against.value : null,
                floor: against.kind === 'underTheFloor' ? against.floor : null,
            },
            workDisagreement: against.workDisagreement,
            abideSource: bodyOf(one.abide),
            handSource: bodyOf(one.hand),
            abideLeaning: leaningOf(one.abideHelpers),
            handLeaning: leaningOf(one.handHelpers),
        })
        onRow?.(
            rows[rows.length - 1] as ReactiveBenchRow,
            rows.length,
            all.length,
        )
    }
    return rows
}

function show(rows: ReactiveBenchRow[]): void {
    const width = Math.max(...rows.map((row) => row.case.length))
    console.log(
        `${'case'.padEnd(width)}  ${'abide'.padStart(11)}  ${'hand'.padStart(11)}  ratio`,
    )
    for (const row of rows) {
        const value =
            row.ratio.kind === 'ratio'
                ? `${(row.ratio.value as number).toFixed(2)}x`
                : row.ratio.kind
        const disagreed = row.workDisagreement.length
            ? `  !! work disagrees: ${row.workDisagreement.join(', ')}`
            : ''
        console.log(
            `${row.case.padEnd(width)}  ${row.abideNanoseconds.toFixed(1).padStart(8)} ns  ${row.handNanoseconds.toFixed(1).padStart(8)} ns  ${value}${disagreed}`,
        )
    }
}

if (import.meta.main) {
    if (Bun.argv.includes('--list')) {
        console.log(JSON.stringify(caseNames()))
        process.exit(0)
    }
    // NDJSON, one line per case, so a caller reading this process fills a table as it
    // goes rather than after. The table form is for a person.
    const streaming = Bun.argv.includes('--json')
    const rows = benchReactive(
        streaming
            ? (row, done, total) =>
                  console.log(JSON.stringify({ row, done, total }))
            : undefined,
    )
    if (!streaming) show(rows)
}
