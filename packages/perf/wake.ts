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

const ROWS = 1000
const WARM = 5
const TIMED = 12

/**
 * Selection moves per timed sample.
 *
 * Chrome coarsens `performance.now()` to 100 µs, and a single move over a thousand rows lands well
 * under that — every arm came back as 0.000 or 0.100 ms, which is the clock's resolution and not a
 * measurement. A batch of moves is milliseconds, so the quantisation is a rounding error on the
 * total rather than the whole of it. This is the same reason the perf harness reports CPU time from
 * `Performance.getMetrics` rather than a wall clock: see the frame-quantisation note in the handoff.
 */
const PER_SAMPLE = 40

export interface Arm {
    label: string
    /** Milliseconds per selection move, median of `TIMED`. */
    ms: number
    /** What the arm has between the write and the attribute, for reading the ladder. */
    through: string
}

/** Effects are microtask-batched, so a measurement has to span the flush, not just the write. */
async function drain(): Promise<void> {
    for (let i = 0; i < 4; i++) await Promise.resolve()
}

function median(values: number[]): number {
    const sorted = values.slice().sort((a, b) => a - b)
    const at = sorted.length >> 1
    return sorted.length % 2 === 0 ? ((sorted[at - 1] as number) + (sorted[at] as number)) / 2 : (sorted[at] as number)
}

/**
 * Time one arm over the same schedule. `move` selects row `i`; `settle` is what the arm needs before
 * the attribute is on screen — nothing for the synchronous floor, a microtask drain for everything
 * reactive. The drain is a few microseconds against a measurement in the hundreds, but it is the one
 * asymmetry between the floor and the rest, so it is spelled rather than hidden.
 */
async function time(move: (i: number) => void, settle: (() => Promise<void>) | null): Promise<number> {
    for (let i = 0; i < WARM; i++) {
        move(i)
        if (settle !== null) await settle()
    }
    const samples: number[] = []
    let step = 0
    for (let sample = 0; sample < TIMED; sample++) {
        const started = performance.now()
        for (let i = 0; i < PER_SAMPLE; i++) {
            // A DIFFERENT row every time: re-selecting the row already selected writes the same two
            // values, every binding compares before it writes, and the arm would time nothing.
            move(100 + (step++ % 700))
            if (settle !== null) await settle()
        }
        samples.push((performance.now() - started) / PER_SAMPLE)
    }
    return median(samples)
}

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

async function vanillaArm(host: HTMLElement): Promise<Arm> {
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
        ms: await time((i) => selected.write(i), null),
        through: 'write → reader → attribute',
    }
}

// --- abide, one layer at a time ---------------------------------------------

async function graphOnlyArm(): Promise<Arm> {
    const selected = state(-1)
    let seen = 0
    for (let i = 0; i < ROWS; i++) {
        watch(() => {
            if (selected() === i) seen++
        })
    }
    await drain()
    const ms = await time((i) => selected.set(i), drain)
    if (seen < 0) throw new Error('unreachable')
    return {
        label: 'abide — 1000 watch, NO dom',
        ms,
        through: 'write → mark → queue → flush → run → body',
    }
}

async function graphWithDomArm(host: HTMLElement): Promise<Arm> {
    const items = listOf(host, 'graph')
    const selected = state(-1)
    for (let i = 0; i < ROWS; i++) {
        const item = items[i] as HTMLElement
        watch(() => {
            const on = selected() === i ? 'on' : ''
            if (item.className !== on) item.className = on
        })
    }
    await drain()
    return {
        label: 'abide — 1000 watch, writing the attribute',
        ms: await time((i) => selected.set(i), drain),
        through: '…+ attribute',
    }
}

async function slotArm(host: HTMLElement): Promise<Arm> {
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
                    keyed(row.id, html`<li class=${() => (row.id === selected() ? 'on' : '')}>${row.label}</li>`),
                )}</ul>`,
    )
    await drain()
    return {
        label: 'abide — 1000 template attribute slots',
        ms: await time((i) => selected.set(i), drain),
        through: '…+ slot effect → unwrap → binder → thunk',
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
    const arms: Arm[] = []
    arms.push(await vanillaArm(host))
    arms.push(await graphOnlyArm())
    arms.push(await graphWithDomArm(host))
    arms.push(await slotArm(host))
    if (attached) host.remove()
    return { arms, rows: ROWS }
}
