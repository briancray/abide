// Driving a demo app's own controls, and pricing what they cost.
//
// The demo declares WHAT it can be asked to do — a label and a selector, in `APPS.ts` — and this asks.
// The split is the whole reason a number here means anything: the measuring code is outside the app
// being measured, so nothing the demo does can be tuned to the instrument, and the demo needs to know
// nothing about being measured.
//
// WHAT THIS CAN AND CANNOT SEE, because the difference decides what a reader should believe:
//
//   · DOM WORK — nodes inserted, removed, created, text written. Counted from inside the page by
//     `harness/measure`, installed on the FRAME's document because chromium gives it its own realm.
//     Exact, and the same number in both substrates.
//   · TIME — wall clock around the op, on the page's own clock. Coarse: a browser clamps
//     `performance.now()` to about 100 µs, so a sub-millisecond op reports the clock rather than the
//     code, and one pass cannot tell 0.4% from zero. Shown as an ORDER OF MAGNITUDE, never as a ratio.
//   · NOT the engine. Style recalculation, layout and paint are only reachable over CDP, which is a
//     Playwright-side protocol a page cannot speak — see `harness/engine.ts`. So the card says what
//     the op DID; what it cost the engine is `bun run e2e`'s to say. The card proves it works; the
//     standalone run prices it.
//
// A ratio would need a hand-written arm in the same substrate, and there is none inside somebody
// else's application. So nothing here is phrased as one.

import type { Metric } from 'harness'
import { install, measureFlush, nonZero, total } from 'harness/measure'

/** One op, as the demo named it. */
export interface Op {
    label: string
    click: string
}

/** How long to let an op settle before reading. A reactive app lands its work on a microtask. */
const SETTLE_MS = 60

const rest = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * Run every op in `frame`, in order, and price each one.
 *
 * IN ORDER and never in parallel, because the counters are global to the page and an op measured
 * beside another has its work billed to whichever one is reading — the same rule the case queue is
 * built on. In order also because the ops depend on each other: `update` on a table nothing has
 * created is not the op the label names.
 *
 * A missing control is reported rather than skipped. A demo that renamed a button would otherwise
 * quietly show three metrics where there were four, which reads as a demo that got faster.
 */
export async function priceOps(document: Document, ops: readonly Op[]): Promise<Metric[]> {
    // The frame's own realm — see `install` in the kit: chromium gives it separate prototypes, so a
    // page-level install counts nothing that happens in here.
    install(document)

    const priced: Metric[] = []
    for (const op of ops) {
        const control = document.querySelector<HTMLElement>(op.click)
        if (control === null) {
            priced.push({ label: op.label, kind: 'work', value: `no ${op.click}` })
            continue
        }

        const started = performance.now()
        // `measureFlush`, not `measure`: the click is synchronous and the WORK is not — a reactive
        // app batches its effects onto a microtask, and a synchronous window would price the click.
        const work = await measureFlush(() => control.click())
        await rest(SETTLE_MS)
        const took = performance.now() - started

        priced.push({
            label: op.label,
            kind: 'work',
            value: `${total(work).toLocaleString()} DOM calls`,
            per: nonZero(work),
        })
        priced.push({
            label: op.label,
            kind: 'time',
            // ONE pass on a coarse clock. Rounded to the tenth of a millisecond it is read at, so the
            // digits do not imply a precision the instrument does not have.
            value: `≈ ${took.toFixed(1)} ms`,
        })
    }
    // Left showing something. The last op a reader wants PRICED is `clear`, and the last thing they
    // want to LOOK at is not an empty table — so the first op runs once more, unmeasured and said so
    // here rather than quietly padding a number.
    const first = ops[0]
    if (first !== undefined) {
        document.querySelector<HTMLElement>(first.click)?.click()
        await rest(SETTLE_MS)
    }
    return priced
}
