// Driving a use case's own controls, and pricing what they cost.
//
// The demo declares WHAT it can be asked to do — a label and a selector, in `USECASES.ts` — and this
// asks. The split is the whole reason a number here means anything: the measuring code is outside the
// demo, so nothing the demo does is tuned to the instrument and the demo needs to know nothing about
// being measured.
//
// SCOPED TO A CONTAINER rather than to a document, and that is the change that let the demos come out
// of their frames. A frame was its own realm and its own id space, so `#sort` could only ever mean the
// demo's; inline on a page that has chrome of its own, a document-wide selector is one collision away
// from pricing the wrong control — silently, since a click that lands on something is a click that
// reports a number.
//
// WHAT THIS CAN AND CANNOT SEE, because the difference decides what a reader should believe:
//
//   · DOM WORK — nodes inserted, removed, created, text written. Counted from inside the page by
//     `harness/measure`. Exact, the same number in both substrates, and unmoved by any stylesheet —
//     which is what makes it the claim worth making on a styled page.
//   · TIME — wall clock around the SCRIPT, and in practice it reports the floor. The window closes
//     when the microtask flush does, so it holds the reconcile and none of the frame; every op on
//     every demo here, including a `create` moving 9,000 DOM calls, lands under a hundred ticks of a
//     clock chromium coarsens to 100 µs. That is a finding rather than a broken instrument, and it is
//     the same one `reorder-layers.e2e.ts` measures from the other side: script is about a fifth of
//     what a reorder costs the engine. A number appears here only when an op gets slow enough to have
//     one, which is exactly when it is worth reading.
//   · NOT the engine. Style recalculation, layout and paint are only reachable over CDP, which is a
//     Playwright-side protocol a page cannot speak — see `harness/engine.ts`. So the card says what
//     the op DID; what it cost the engine is `bun run e2e`'s to say.
//
// A ratio would need a hand-written arm doing the same work in the same substrate. `/bench` has those
// per capability; a whole use case has none, so nothing here is phrased as one.

import { type Metric, sleep } from 'harness'
import { clockResolution, install, measureFlush, nonZero, total } from 'harness/measure'
import type { Op } from '#shared/demos/usecases/USECASES.ts'

/** How long to let the page quiesce BETWEEN ops. Never inside the timing window — see `priceOps`. */
const SETTLE_MS = 60

/**
 * The smallest sample worth printing digits for: a hundred ticks of this browser's clock.
 *
 * `performance.now()` is coarsened — 100 µs in chromium — so a sample under this many ticks reports
 * the CLOCK rather than the code, and `≈ 2.4 ms` on a 0.1 ms clock is twenty-four ticks wearing two
 * decimal places. Measured once here rather than assumed, because the coarsening differs by browser
 * and by whether the page is cross-origin-isolated.
 *
 * The usual answer to a sample this small is to batch n operations into one, and it is not available
 * here: these ops are not idempotent — `create`, `append` and `swap` each change what the next one
 * would do — so the honest thing is to say the op is under the floor rather than to print a number.
 *
 * ON FIRST USE rather than at module scope, because `clockResolution` spins 5,000 iterations with two
 * clock reads apiece and this module is imported from `UseCase.abide`'s `<script module>`. At module
 * scope that probe ran on every server render of `/demos/<name>` — for a number the server never
 * reads — and again on the browser's main thread before the demo had drawn, for a number nothing
 * needs until somebody presses `#price`.
 */
let floorMs = 0
function floor(): number {
    if (floorMs === 0) floorMs = clockResolution() * 100
    return floorMs
}

/** How long to wait for the demo to have controls at all. `data` arrives over an rpc. */
const READY_MS = 20_000
const POLL_MS = 50

/**
 * Wait until the first op's control is in `container`.
 *
 * Without this the `data` use case is priced while its rpc is still in flight: every selector misses,
 * and four ops report "no #sort" — which reads as a demo that lost its controls rather than one that
 * had not been answered yet.
 *
 * NOT the harness's `until`, which throws and polls every 2 ms: giving up is a METRIC here rather than
 * a failure — the card says which control never showed — and a 20-second deadline at 2 ms is ten
 * thousand `querySelector` calls on the main thread of a page the reader is looking at.
 */
async function ready(container: Element, first: Op): Promise<boolean> {
    for (let waited = 0; waited * POLL_MS < READY_MS; waited++) {
        if (container.querySelector(first.on) !== null) return true
        await sleep(POLL_MS)
    }
    return false
}

/**
 * Ask one control to do its thing.
 *
 * A CLICK unless the op carries a value, because a click on a `<select>` opens it and changes nothing —
 * and the sort is the entire reason the `media` and `data` demos exist. Both events are dispatched
 * rather than the one that fits: `BINDABLE` in the compiler binds an `<input>` on `input` and a
 * `<select>` on `change`, so a driver that picked one would work on half the controls and silently
 * price a no-op on the rest.
 */
function ask(control: HTMLElement, op: Op): void {
    if (op.value === undefined) {
        control.click()
        return
    }
    ;(control as HTMLInputElement | HTMLSelectElement).value = op.value
    control.dispatchEvent(new Event('input', { bubbles: true }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Run every op inside `container`, in order, and price each one.
 *
 * IN ORDER and never in parallel, because the counters are global to the realm and an op measured
 * beside another has its work billed to whichever one is reading — the same rule the case queue is
 * built on. In order also because the ops depend on each other: `update` on a table nothing has
 * created is not the op the label names.
 *
 * A missing control is reported rather than skipped. A demo that renamed a button would otherwise
 * quietly show three metrics where there were four, which reads as a demo that got faster.
 */
export async function priceOps(container: Element, ops: readonly Op[]): Promise<Metric[]> {
    const first = ops[0]
    if (first === undefined) return []

    // The realm the container is in. Same as the page's here, and asked for through the element rather
    // than assumed, because that is the one fact a caller cannot get wrong by moving the demo.
    install(container.ownerDocument)

    if (!(await ready(container, first))) {
        return [{ label: 'the demo', kind: 'work', value: `never showed ${first.on}` }]
    }

    const priced: Metric[] = []
    for (const op of ops) {
        const control = container.querySelector<HTMLElement>(op.on)
        if (control === null) {
            priced.push({ label: op.label, kind: 'work', value: `no ${op.on}` })
            continue
        }

        const started = performance.now()
        // `measureFlush`, not `measure`: the click is synchronous and the WORK is not — a reactive app
        // batches its effects onto a microtask, and a synchronous window would price the click.
        const work = await measureFlush(() => ask(control, op))
        // CLOSED before the settle, and that is the whole of what this line is for. The settle used to
        // sit inside the window, so every op on every demo reported `≈ 6x ms` — 60 of them the sleep,
        // the rest whatever the op cost — and the numbers looked plausible enough to read for a while
        // because they were all in the same place. A quiesce is not the op.
        const took = performance.now() - started
        await sleep(SETTLE_MS)

        priced.push({
            label: op.label,
            kind: 'work',
            value: `${total(work).toLocaleString()} DOM calls`,
            per: nonZero(work),
        })
        priced.push({
            label: op.label,
            kind: 'time',
            // ONE pass on a coarse clock, so a sample under the floor says so instead of printing
            // digits the instrument cannot support. The DOM calls above are the number to read on a
            // small op — they are exact, and they are the same in both substrates.
            value:
                took < floor()
                    ? `under ${floor().toFixed(1)} ms — this clock’s floor`
                    : `≈ ${took.toFixed(1)} ms`,
        })
    }

    // Left showing something. The last op a reader wants PRICED is often `clear`, and the last thing
    // they want to LOOK at is not an empty table — so the first op runs once more, unmeasured and said
    // so here rather than quietly padding a number.
    const control = container.querySelector<HTMLElement>(first.on)
    if (control !== null) ask(control, first)
    await sleep(SETTLE_MS)
    return priced
}
