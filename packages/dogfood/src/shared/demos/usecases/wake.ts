// The wake path, measured in the substrate that decides it.
//
// Two structural changes to `graph.ts` were designed off a bun/JSC profile and both measured as
// no-ops in Chrome: making the subscription churn 8.3x cheaper, and then removing it entirely. The
// profile that motivated them could only ever be taken where `bun test` runs, and V8 disagreed twice.
// So the arms live here, in the app the browser actually loads, and the comparison is the same
// hand-written floor the rest of this package is measured against.
//
// Each arm moves a SELECTION across a thousand rows — the `select row` op of the complex page. What
// separates the arms is how much of the framework sits between the write and the attribute.
//
// These arms answered their question and the answer held: the whole framework path is ~0.055 ms of an
// op the harness reported at 1.45. What they could not say was where the other 96% went, and the
// guesses were the `<table>` and the CSS behind `.danger`. It was the CSS, and not because the rule is
// expensive — because `app.html` was the only one of six comparison arms that shipped ANY stylesheet.
// Blink builds its style invalidation sets from the stylesheets, so on the five unstyled arms writing
// `class="danger"` matched no rule, recalculated no style and painted nothing. Both directions, both
// arms, `RecalcStyleCount` per click and the sampler agreeing: 0.97 ms with the rule and 0.37 without.
// The rule now lives in the harness and every arm gets it. See ~/code/abide-op-profile.ts.
//
// So the ladder below prices what it says it prices, and nothing above it is waiting on an answer.

import { html, state, watch } from 'abide'
import { keyed } from 'abide/runtime'
import { mount } from 'abide/ui'
// The harness's measurement half, which has no abide in its graph — so the hand-written floor below is timed
// by the same clock, the same batch sizing and the same quiesce as the arms it is the control for.
import { quiesce, tick, timeArms } from 'harness/measure'

const ROWS = 1000

/** One arm of the ladder, with its number — what the page shows and the harness reads. */
export interface Arm {
    label: string
    /** Milliseconds per selection move, best of the interleaved passes. */
    ms: number
    /** What the arm has between the write and the attribute, for reading the ladder. */
    through: string
}

/**
 * One arm of the ladder, before it has a number.
 *
 * `run` moves the selection to row `i` and, for everything reactive, RETURNS the flush — `timeArms`
 * awaits a thenable per operation, so the wait lands exactly where the arm needs it and the synchronous
 * floor pays nothing for it.
 */
interface Rung {
    label: string
    through: string
    run: (i: number) => unknown
}

/**
 * A DIFFERENT row every time.
 *
 * Re-selecting the row already selected writes the same two values, every binding compares before it
 * writes, and the arm would time nothing at all. `timeArms` hands `i` up monotonically, which is what
 * makes this a walk rather than a repeat.
 */
const rowFor = (i: number): number => 100 + (i % 700)

function listOf(host: HTMLElement, tag: string): HTMLElement[] {
    const holder = document.createElement('ul')
    holder.dataset.arm = tag
    host.append(holder)
    const items: HTMLElement[] = []
    for (let i = 0; i < ROWS; i++) {
        const item = document.createElement('li')
        item.textContent = `row ${i}`
        holder.append(item)
        items.push(item)
    }
    return items
}

// --- the hand-written floor -------------------------------------------------
//
// The smallest thing that does this job: subscribers in an array, swap-remove on re-run, no batching.

class Signal {
    readers: Reader[] = []
    constructor(public value: number) {}
    read(reader: Reader | null): number {
        if (reader !== null) {
            this.readers.push(reader)
            reader.sources.push(this)
        }
        return this.value
    }
    write(next: number): void {
        if (this.value === next) return
        this.value = next
        for (let i = 0; i < this.readers.length; i++) (this.readers[i] as Reader).run()
    }
}

class Reader {
    sources: Signal[] = []
    constructor(private readonly body: (reader: Reader) => void) {
        this.run()
    }
    run(): void {
        for (let i = 0; i < this.sources.length; i++) {
            const source = this.sources[i] as Signal
            const at = source.readers.indexOf(this)
            if (at !== -1) {
                source.readers[at] = source.readers[source.readers.length - 1] as Reader
                source.readers.pop()
            }
        }
        this.sources = []
        this.body(this)
    }
}

function vanillaRung(host: HTMLElement): Rung {
    const items = listOf(host, 'vanilla')
    const selected = new Signal(-1)
    for (let i = 0; i < ROWS; i++) {
        const item = items[i] as HTMLElement
        new Reader((reader) => {
            const on = selected.read(reader) === i ? 'on' : ''
            if (item.className !== on) item.className = on
        })
    }
    return {
        label: 'vanilla — array subscribers, no batching',
        through: 'write → reader → attribute',
        // Synchronous all the way to the attribute, so it returns nothing to await. That asymmetry is
        // the one thing separating this from the rungs below, and it is spelled rather than hidden.
        run: (i) => selected.write(rowFor(i)),
    }
}

// --- abide, one layer at a time ---------------------------------------------

/**
 * What the effect bodies observed, and DELIBERATELY read from outside.
 *
 * A body whose only effect is a counter nobody reads is a body an engine may prove dead, and this rung's
 * whole point is that the graph ran. `observedWakes` is the reader that makes the increment survive —
 * the same trick as the harness's `keep` / `keptValue` pair.
 */
let observed = 0

export const observedWakes = (): number => observed

function graphOnlyRung(): Rung {
    const selected = state(-1)
    for (let i = 0; i < ROWS; i++) {
        watch(() => {
            if (selected() === i) observed++
        })
    }
    return {
        label: 'abide — 1000 watch, NO dom',
        through: 'write → mark → queue → flush → run → body',
        run: (i) => {
            selected.set(rowFor(i))
            return tick()
        },
    }
}

function graphWithDomRung(host: HTMLElement): Rung {
    const items = listOf(host, 'graph')
    const selected = state(-1)
    for (let i = 0; i < ROWS; i++) {
        const item = items[i] as HTMLElement
        watch(() => {
            const on = selected() === i ? 'on' : ''
            if (item.className !== on) item.className = on
        })
    }
    return {
        label: 'abide — 1000 watch, writing the attribute',
        through: '…+ attribute',
        run: (i) => {
            selected.set(rowFor(i))
            return tick()
        },
    }
}

function slotRung(host: HTMLElement): Rung {
    const rows: { id: number; label: string }[] = []
    for (let i = 0; i < ROWS; i++) rows.push({ id: i, label: `row ${i}` })
    const holder = document.createElement('div')
    holder.dataset.arm = 'slot'
    host.append(holder)
    const cell = state(rows)
    const selected = state(-1)
    // The compiler's own emit for `<li class={row.id === selected ? 'on' : ''}>` inside a `{#for}`.
    mount(
        holder,
        () =>
            html`<ul>${() =>
                cell().map((row) =>
                    keyed(
                        row.id,
                        html`<li class=${() => (row.id === selected() ? 'on' : '')}>${row.label}</li>`,
                    ),
                )}</ul>`,
    )
    return {
        label: 'abide — 1000 template attribute slots',
        through: '…+ slot effect → unwrap → binder → thunk',
        run: (i) => {
            selected.set(rowFor(i))
            return tick()
        },
    }
}

/**
 * Every arm, into a detached host so nothing here is measuring layout of a visible thousand-row list.
 *
 * Run in ladder order and reported that way: each arm adds one layer to the one above it, so the
 * difference between two neighbours is what that layer costs. An absolute number here says nothing
 * on its own — the floor is the first row, and everything else is a ratio against it.
 */
export async function profileWakePath(attached: boolean): Promise<{ arms: Arm[]; rows: number }> {
    const host = document.createElement('div')
    // Both, because the two answer different questions. DETACHED isolates the framework: no style
    // recalculation, no layout, so what is left is the graph and the bindings. ATTACHED is what the
    // page does. They read the same here (0.054 against 0.055) and that is not a null result — these
    // arms use `.on`, which no rule in the app matches, so Blink invalidates nothing on the write.
    // That is exactly the condition that decided the framework comparison, and it is spelled at the
    // top of this file: to make attaching cost anything, give the class a rule first.
    if (attached) document.body.append(host)

    // Every rung BUILT before any of them is timed, which is the change that made this file honest.
    // It used to build one, time it to completion, then build the next — and an arm timed after another
    // inherits whatever that one left behind. The harness's own note prices that mistake: the same
    // hand-written emitter measured 38.6 ns alone and 8.84 µs after abide's arm had run, which reads as
    // "abide 121x faster" instead of "2.21x slower". `timeArms` interleaves one batch per arm per pass,
    // so the drift is spread across all of them rather than loaded onto whichever ran second.
    const rungs: Rung[] = [
        vanillaRung(host),
        graphOnlyRung(),
        graphWithDomRung(host),
        slotRung(host),
    ]
    await tick()

    const timings = await timeArms(rungs, quiesce)
    const arms: Arm[] = rungs.map((rung, at) => ({
        label: rung.label,
        through: rung.through,
        ms: (timings[at] as { p50: number }).p50 / 1e6,
    }))

    if (attached) host.remove()
    return { arms, rows: ROWS }
}
