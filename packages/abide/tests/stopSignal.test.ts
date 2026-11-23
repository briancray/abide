// `stopSignal` — A JOB TOLD TO STOP (RULEBOOK 7.38, 7.39), and a run that gives up when it is told
// (4.12, 7.28, 37.28). A file of its own: every job a file builds is filed for the process, and is
// started again by every app the file opens after it, so a count of warnings is only a count of
// these jobs' here.

import { expect, test } from 'bun:test'

import type { App, BootedApp } from '#server/createApp.ts'
import { log, memo, reactive, stopSignal, watch } from '#shared'
import { collectWatches } from '#shared/reactive/watch.ts'

import { inMemoryApp } from './inMemoryApp.ts'

/** What `App.listen` and `abide dev` open, with no socket to bind here (7.30). */
function serving(app: App): void {
    ;(app as BootedApp).openMux()
}

/** Settles once `signal` aborts, rejecting with its reason — a run giving up as it was asked to. */
function givenUp(signal: AbortSignal): Promise<never> {
    return new Promise((_, fail) => {
        if (signal.aborted) fail(signal.reason)
        signal.addEventListener('abort', () => fail(signal.reason), {
            once: true,
        })
    })
}

function warningsSince(before: number, mentioning: string): number {
    let count = 0
    for (const record of (log.records.peek() ?? []).slice(before))
        if (
            record.namespace === 'abide:reactive' &&
            record.message.includes(mentioning)
        )
            count += 1
    return count
}

// 4.12, 7.28, 37.28 — A RUN THAT ENDS BECAUSE THE APP STOPPED IS NOT A FAILURE: a job that already
// landed and a job whose first run is the one told to stop each give up on the stop with no warning,
// and the first goes on serving what it held. A job that genuinely fails is still warned on, once.
//
// THE REVERTS: drop the two `isAbort(failure)` tests from `warnFailure`, and `aborted runs warned: 2`
// — one 4.12 revalidation, one 7.28 polled run, on every stop; have `isAbort` test `instanceof
// DOMException` alone, and the same 2 — the preload's DOM stands in for the `DOMException` the
// runtime's `AbortController` aborts with.
test('a job giving up on stopSignal is not warned on, and a failing one still is — 4.12, 7.28, 37.28', async () => {
    const before = (log.records.peek() ?? []).length
    let landedRuns = 0
    const landed = memo(
        () => {
            landedRuns += 1
            return landedRuns === 1 ? 1 : givenUp(stopSignal())
        },
        { global: true, poll: 5 },
    )
    memo(() => givenUp(stopSignal()), { global: true, poll: 5 })
    memo(
        (): number => {
            throw new Error('the feed could not be read')
        },
        { global: true, poll: 60_000 },
    )
    const app = await inMemoryApp({})
    serving(app)
    while (landedRuns < 2) await Bun.sleep(1)
    await app.stop()
    expect(
        `aborted runs warned: ${warningsSince(before, 'AbortError')}, failures warned: ${warningsSince(before, 'the feed could not be read')}, held: ${landed.peek()}`,
    ).toBe('aborted runs warned: 0, failures warned: 1, held: 1')
})

// 7.38, 7.39 — THE SIGNAL SAYS STOP FOR THE STOP, AND NO LONGER: aborted before the drain, still
// aborted as the drain waits on the run it told, and a fresh one once `App.stop` resolves — so code
// that links it after an app's stop, in the same process with no app built since, is not handed a
// signal that already says stop.
//
// THE REVERTS: renew in `bootEntered` again rather than at the end of `stopOnce`, and `after the
// stop: true`; renew in `stopUnownedPolls` right after the abort, and `during the drain: false`.
test('stopSignal is aborted from the stop through its drain, and fresh once the stop resolves — 7.38, 7.39', async () => {
    let started = false
    let duringTheDrain: boolean | undefined
    memo(
        async () => {
            started = true
            await givenUp(stopSignal()).catch(() => undefined)
            // A turn past the abort, as a run winding down takes, and still inside the drain.
            await Bun.sleep(5)
            duringTheDrain = stopSignal().aborted
            return 0
        },
        { global: true, poll: 60_000 },
    )
    const app = await inMemoryApp({})
    serving(app)
    while (!started) await Bun.sleep(1)
    const told = stopSignal()
    await app.stop()
    expect(
        `told: ${told.aborted}, during the drain: ${duringTheDrain}, after the stop: ${stopSignal().aborted}`,
    ).toBe('told: true, during the drain: true, after the stop: false')
})

// 7.45, 7.46 — INSIDE A BODY THE SIGNAL IS THE RUN'S OWN: a run asking for it is handed one the
// app's stop does not share, and the next run of the same value ends it — the work the first run
// started is owed to nobody.
//
// THE REVERTS: answer `STOPPING.signal` from `stopSignal` whatever runs, and `own: false, first
// after a rerun: false`; drop the `endRunSignal` from `run`, and `first after a rerun: false`.
test('stopSignal in a memo body is its run’s own, ended by the next run — 7.45, 7.46', () => {
    const query = reactive('lead')
    const signals: AbortSignal[] = []
    const found = memo(() => {
        const asked = query()
        signals.push(stopSignal())
        return asked
    })
    found()
    const first = signals[0] as AbortSignal
    const own = first !== stopSignal()
    query.set('won')
    found()
    expect(
        `own: ${own}, first after a rerun: ${first.aborted}, second: ${(signals[1] as AbortSignal).aborted}`,
    ).toBe('own: true, first after a rerun: true, second: false')
})

// 7.46 — A VALUE RELEASED ENDS ITS RUN'S SIGNAL: a `memo` its setup built, loading when that setup
// stops and read by nothing else (12.14), is owed to nobody, so the run it started is told to stop.
// THE REVERT: drop the `endRunSignal` from `releaseOrphan`, and `released: false`.
test('a memo released while it loads ends the signal its run asked for — 7.46, 12.14', () => {
    let asked: AbortSignal | undefined
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const loading = memo(() => {
        asked = stopSignal()
        return new Promise<number>(() => undefined)
    })
    collectWatches(previous)
    const stopReader = watch(() => {
        loading.busy()
    })
    const before = (asked as AbortSignal).aborted
    stopReader()
    for (const stop of stops) stop()
    expect(
        `before: ${before}, released: ${(asked as AbortSignal).aborted}`,
    ).toBe('before: false, released: true')
})

// 7.46 — 7.38'S ABORT REACHES A RUN THAT ASKED: a run still in flight when the app stops is told, as
// the app's own signal is. THE REVERT: drop the listener `stopSignal` adds on `STOPPING`, and
// `told: false`.
test('a run that asked for its signal is told when the app stops — 7.46', async () => {
    let asked: AbortSignal | undefined
    memo(
        () => {
            asked = stopSignal()
            return givenUp(asked).catch(() => 0)
        },
        { global: true, poll: 60_000 },
    )
    const app = await inMemoryApp({})
    serving(app)
    while (asked === undefined) await Bun.sleep(1)
    await app.stop()
    expect(`told: ${asked.aborted}`).toBe('told: true')
})
