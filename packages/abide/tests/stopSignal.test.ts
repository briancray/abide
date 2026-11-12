// `stopSignal` — A JOB TOLD TO STOP (RULEBOOK 7.38, 7.39), and a run that gives up when it is told
// (4.12, 7.28, 37.28). A file of its own: every job a file builds is filed for the process, and is
// started again by every app the file opens after it, so a count of warnings is only a count of
// these jobs' here.

import { expect, test } from 'bun:test'

import type { App, BootedApp } from '#server/createApp.ts'
import { log, reactive, stopSignal } from '#shared'

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
    const landed = reactive(
        () => {
            landedRuns += 1
            return landedRuns === 1 ? 1 : givenUp(stopSignal())
        },
        { global: true, poll: 5 },
    )
    reactive(() => givenUp(stopSignal()), { global: true, poll: 5 })
    reactive(
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
    reactive(
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
