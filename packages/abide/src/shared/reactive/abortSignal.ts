// THE SIGNAL THAT SAYS STOP. RULEBOOK 7.20, 7.21 and 7.22 through 7.26: `abortSignal` answers the innermost owner the
// work it is called in runs under — a `memo` run's own, the request being served, a `job`'s run — and
// outside all of them the one `App.stop` aborts before it drains what is in flight.

import type { Cell } from './cellShape.ts'
import { SCOPING } from './scoping.ts'

/** 7.20, 7.21 — what `abortSignal` answers outside every run and request: aborted by a stop, replaced as that stop ends. */
let STOPPING = new AbortController()

/**
 * The value whose body is running on this stack — its synchronous part, or a step of its stream —
 * for `abortSignal` to answer that run's own signal in a browser (7.22, 7.26). Set and restored
 * around the call, so a body that reaches another value's body sees its own again once that one
 * returns. A server reads the run `runAsRun` carries instead, which survives an `await` (7.24).
 */
export const BODY_RUN: { cell: Cell | null } = { cell: null }

/**
 * The signal that says stop to the work this is called in — the innermost owner it runs under, which
 * aborts where any owner above it does: a `memo` run's own (7.22, 7.23, 7.24), the request being
 * served (7.25), a `job`'s run (54.32), and otherwise the one `App.stop` aborts before it waits on what is in flight (7.20).
 * Never aborted where no app stops and no run is replaced, a browser outside a run among them.
 */
export function abortSignal(): AbortSignal {
    const provider = SCOPING.provider
    if (provider === null) {
        const cell = BODY_RUN.cell
        return cell === null
            ? STOPPING.signal
            : runSignal(cell, STOPPING.signal)
    }
    const mark = provider.currentRun()
    if (mark === undefined) return provider.ownerSignal() ?? STOPPING.signal
    const cell = mark.cell
    // 7.24 — a continuation of a run 7.23 has already ended: that run's signal said stop.
    if (mark.epoch !== cell.runEpoch) return AbortSignal.abort()
    // 7.23 — A `global` VALUE'S RUN IS NO REQUEST'S (44.57), whichever request reached it first.
    const owner = cell.global
        ? STOPPING.signal
        : (provider.requestSignal(cell.scope) ?? STOPPING.signal)
    return runSignal(cell, owner)
}

/** 7.22 — the current run's signal, made on the first ask and aborted where `owner` is (7.23). */
function runSignal(cell: Cell, owner: AbortSignal): AbortSignal {
    const standing = cell.runStop
    if (standing !== null) return standing.signal
    const run = new AbortController()
    cell.runStop = run
    if (owner.aborted) run.abort(owner.reason)
    else
        // Removed by the run's own abort, so a long-lived owner does not keep one per run it saw.
        owner.addEventListener('abort', () => run.abort(owner.reason), {
            once: true,
            signal: run.signal,
        })
    return run.signal
}

/**
 * The signal `App.stop` aborts (7.20), wherever it is read — for work a body starts that outlives the
 * run, as a job's run outlives the look that started it.
 */
export function appStopSignal(): AbortSignal {
    return STOPPING.signal
}

/**
 * 7.23 — the value's run is over: a continuation of it is told so (7.24), and the signal it handed
 * out, where one was asked for, says stop.
 */
export function endRun(cell: Cell): void {
    cell.runEpoch += 1
    const run = cell.runStop
    if (run === null) return
    cell.runStop = null
    run.abort()
}

/** 7.21 — a stop that has ended leaves a signal that does not already say stop. */
export function renewStopSignal(): void {
    if (STOPPING.signal.aborted) STOPPING = new AbortController()
}

/** 7.20 — `App.stop`'s abort of the signal `abortSignal` answers outside every run and request. */
export function abortStopSignal(): void {
    STOPPING.abort()
}
