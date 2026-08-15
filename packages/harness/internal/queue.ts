// What a page holds while a case runs, and the queue that decides when that is.
//
// Two facts shape this file. The first is that a case's log is APPENDED to and read whole: pushing a
// line must not cost a copy of every line before it, so the lines live in one array with a version
// cell beside them and the snapshot is taken on the read that follows. The second is that the cases
// on a page must run ONE AT A TIME — the DOM counters `harness/measure` installs are global and a
// `measureFlush` window is a few microtasks wide, so a case started beside another has its work
// billed to whichever one is measuring. `a write costs one text write` read 25 that way, and drifted
// between loads.
//
// In the harness rather than in the app whose pages it drives, and the second fact is why: "one at a time"
// is a rule about the COUNTERS, which are the harness's and are global to a page. An app that ran cases
// two at a time would not fail — it would report numbers billed to the wrong case — so the rule cannot
// live somewhere each app is trusted to re-derive it. Nothing here paints anything; a `Status` is a
// word, and which colour that word gets is the page's business.

import { memo, type State, state } from 'abide'
import { type Case, collector, context, type LogLine, type Sink, sweepContainers } from '../harness.ts'
import { framed } from './frame.ts'

/** Where a case is. `waiting` is a card the queue has not reached yet. */
export type Status = 'waiting' | 'running' | 'passing' | 'failed' | 'interactive' | 'benched' | 'server'

export interface Running {
    status: State<Status>
    /** Every line so far. A snapshot per FLUSH, not per line — see the version cell below. */
    lines: () => LogLine[]
    /** Where a line that is not the case's own goes — the throw that ended it. */
    sink: Sink
    /**
     * The live area to run in, as of NOW rather than as of the enqueue.
     *
     * A queue entry that captured the node instead was holding one the page had already replaced: a
     * filter dropping one row rebuilds the rows around it, so every case behind the drop waited
     * forever on a detached element while its own row sat on screen saying `waiting`. Read at the
     * moment the case starts, so whatever the reconcile did in between is somebody else's business.
     */
    host: HTMLElement | null
    /** Set once the case is in the queue, so a re-bound element cannot enqueue it twice. */
    queued: boolean
}

/**
 * The state behind one card, and the sink that fills it.
 *
 * No host: a live area is a browser's, and this is built during a render that may be happening on a
 * server. `collector()` from the harness is what actually holds the lines, so "a live line REPLACES
 * the last one with its label" is implemented once and is the same rule headless and on screen. The
 * only thing added here is the version cell — the array is mutated in place, and a cell handing back
 * the same array identity would wake nobody.
 */
export function running(): Running {
    const collected = collector()
    const written = state(0)
    const bump = (): void => written.set(written.peek() + 1)

    return {
        status: state<Status>('waiting'),
        lines: memo(() => {
            written()
            // Copied on the READ, which is once per flush however many lines landed in it.
            return collected.lines.slice()
        }),
        sink: {
            line(line) {
                collected.sink.line(line)
                bump()
            },
            live(line) {
                collected.sink.live(line)
                bump()
            },
        },
        host: null,
        queued: false,
    }
}

/** A queued case, and the PAGE it was queued for. */
interface Queued {
    at: string
    run: () => Promise<void>
}

const WAITING: Queued[] = []

/**
 * Which page the queue is working through, or `null` for none.
 *
 * The queue is one module-level line for the whole app, because the order cases run in is the order
 * they are on the page and that is the only order their measurements are true in. What that costs is
 * a lifetime longer than any one page's: a case that never settles — a `run` that hangs, a stream
 * that never ends — used to wedge the drain FOREVER, and every card on every page navigated to
 * afterwards then sat at `waiting` behind a case whose DOM had already been thrown away.
 *
 * So a drain is scoped to a page rather than to a boolean. A navigation abandons the old one where it
 * stands: the hung case is left hung, its page is gone, and the new page's cases start.
 *
 * Read off `location` rather than off `route()`, deliberately. This module is imported by `card.abide`
 * and therefore by a SERVER rendering a page, where `route()` answers about a caller that does not
 * exist at import time — and by `bun test`, where there is a document but no address bar. A string
 * nobody has to install is the one form that cannot throw in either.
 */
let drainingAt: string | null = null

const here = (): string => location.pathname + location.search

/**
 * Run this case, in its own live area, when every case queued before it is done.
 *
 * Cards enqueue as their live area lands, so the order is the page's — which is also the order `bun
 * test` runs them in, and the only order their measurements are true in.
 */
export function enqueue(spec: Case, held: Running, host: HTMLElement): void {
    // Taken every time, not only on the first call. A row rebuilt while its case is still in the queue
    // — which is what a filter dropping a row above it does — binds a new live area, and the entry
    // waiting for it must follow. See `Running.host`.
    held.host = host
    if (held.queued) return
    held.queued = true
    const at = here()
    WAITING.push({ at, run: () => start(spec, held) })
    // Compared against the PAGE rather than tested for truth: a drain wedged on a case that never
    // settles is still "draining", and a boolean here is what let one hung case silence the app.
    if (drainingAt !== at) void drain(at)
}

async function drain(at: string): Promise<void> {
    drainingAt = at
    try {
        for (;;) {
            // Checked before each case rather than only at the top: a navigation part-way through a
            // page's queue should stop it there, not after one more case has run against dead DOM.
            if (here() !== at) return
            const next = WAITING.shift()
            if (next === undefined) return
            if (next.at !== at) continue
            await next.run()
        }
    } finally {
        // Only if this drain is still the current one. A hung drain never reaches here at all, which
        // is exactly what leaves `drainingAt` on the old page for the next `enqueue` to see.
        if (drainingAt === at) drainingAt = null
    }
}

/**
 * `run` first, because its assertions are the claim; `interact` second, because it is the part that
 * needs a person. A failed assertion stops the case exactly as it stops the test.
 */
async function start(spec: Case, held: Running): Promise<void> {
    // A live area that has left the document is a case nobody is showing any more — a filter dropped
    // its row while the queue was still working towards it. Skipped rather than run: the queue is one
    // line for the whole page, so a hidden case is not free, it is every visible case behind it
    // waiting. `queued` is put back so re-showing the row queues it again, which is what makes the
    // chips on `/tests` reversible rather than a one-way discard.
    //
    // Read off `held` at the last moment rather than captured when the case was queued, which is the
    // difference between "nobody is showing this" and "somebody rebuilt the row". See `Running.host`.
    const host = held.host
    if (host === null || !host.isConnected) {
        held.queued = false
        return
    }

    const ctx = context(host, held.sink)
    held.status.set('running')
    try {
        // A document of its own, BEFORE `run`, because a case may carry both and the frame is the
        // thing the page can see: a reader watching a row open should find the subject already there
        // rather than appearing after a body they cannot see has finished.
        if (spec.visit !== undefined) {
            const frame = await framed(host)
            if (frame === null) {
                held.sink.line({ label: 'no frame', value: 'this lane cannot give a case a document', kind: 'note' })
            } else {
                await spec.visit(ctx, frame)
            }
        }
        if (spec.run !== undefined) {
            await spec.run(ctx)
            held.status.set('passing')
        } else if (spec.visit !== undefined) {
            // A visit-only case is asserted like a `run`: it got its document and its body did not
            // throw. Ahead of the `server` arm below so a case carrying both is not reported as the
            // thing it could NOT do here.
            held.status.set('passing')
        } else if (spec.server !== undefined) {
            // NOT run, and not silently either. `serve()` needs an `AsyncLocalStorage`, so this body
            // throws in a browser — the row said `failed` and meant "this page cannot ask", which is
            // the one thing a red row must never mean.
            held.status.set('server')
            held.sink.line({ label: 'server only', value: 'asserted under `bun test`', kind: 'note' })
        } else {
            held.status.set(spec.bench !== undefined ? 'benched' : 'interactive')
        }
        spec.interact?.(ctx)
    } catch (error: unknown) {
        held.status.set('failed')
        held.sink.line({ label: 'the case threw', value: String(error), kind: 'fail' })
    } finally {
        // Whatever the case rendered into `container()` and did not take down — a case that threw
        // before its own `remove`, and every bench arm that makes one per iteration. In a browser
        // `document.body` is the page being read, so leftovers stack up unstyled under the last card.
        sweepContainers()
    }
}
