// `abortSignal` — A JOB TOLD TO STOP (RULEBOOK 7.20, 7.21), a run that gives up when it is told
// (4.12, 37.28), and the owners between them: a run, carried across its `await`s on a server
// (7.22-7.47), and the request it is filed in (7.25). A file of its own: every job a file builds is filed for the process, and is
// started again by every app the file opens after it, so a count of warnings is only a count of
// these jobs' here.

import { expect, test } from 'bun:test'

import { job } from '#server'
import type { App, BootedApp } from '#server/createApp.ts'
import { inOpenScope, scopeFor } from '#server/requestScope.ts'
import { abortSignal, log, reactive, watch } from '#shared'
import { appStopSignal } from '#shared/reactive/abortSignal.ts'
import { SCOPING } from '#shared/reactive/scoping.ts'
import { collectWatches } from '#shared/reactive/watch.ts'

import { inMemoryApp } from './inMemoryApp.ts'

/** What `App.listen` and `abide dev` open, with no socket to bind here (54.11). */
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

// 4.12, 37.28 — A RUN THAT ENDS BECAUSE THE APP STOPPED IS NOT A FAILURE: a value that landed and
// is revalidating when the app stops gives up with no warning, and goes on serving what it held.
//
// THE REVERTS: drop the `isAbort(failure)` test from `warnFailure`, and `aborted runs warned: 1`; have
// `isAbort` test `instanceof DOMException` alone, and the same 1 — the preload's DOM stands in for
// the `DOMException` the runtime's `AbortController` aborts with.
test('a revalidation giving up on abortSignal is not warned on — 4.12, 37.28', async () => {
    const before = (log.records.peek() ?? []).length
    let runs = 0
    const landed = reactive(() => {
        runs += 1
        return runs === 1 ? 1 : givenUp(abortSignal())
    })
    landed.get()
    landed.refresh()
    const app = await inMemoryApp({})
    serving(app)
    await app.stop()
    await Bun.sleep(1)
    expect(
        `aborted runs warned: ${warningsSince(before, 'AbortError')}, held: ${landed.peek()}`,
    ).toBe('aborted runs warned: 0, held: 1')
})

// 7.20, 7.21 — THE SIGNAL SAYS STOP FOR THE STOP, AND NO LONGER: aborted before the drain, still
// aborted as the drain waits on the run it told, and a fresh one once `App.stop` resolves — so code
// that links it after an app's stop, in the same process with no app built since, is not handed a
// signal that already says stop.
//
// THE REVERTS: renew in `bootEntered` again rather than at the end of `stopOnce`, and `after the
// stop: true`; renew in `abortStopSignal` right after the abort, and `during the drain: false`.
test('abortSignal is aborted from the stop through its drain, and fresh once the stop resolves — 7.20, 7.21', async () => {
    let started = false
    let duringTheDrain: boolean | undefined
    job({
        every: 60_000,
        run: async () => {
            started = true
            await givenUp(abortSignal()).catch(() => undefined)
            // A turn past the abort, as a run winding down takes, and still inside the drain.
            await Bun.sleep(5)
            duringTheDrain = appStopSignal().aborted
        },
    })
    const app = await inMemoryApp({})
    serving(app)
    while (!started) await Bun.sleep(1)
    const told = abortSignal()
    await app.stop()
    expect(
        `told: ${told.aborted}, during the drain: ${duringTheDrain}, after the stop: ${abortSignal().aborted}`,
    ).toBe('told: true, during the drain: true, after the stop: false')
})

// 7.22, 7.23 — INSIDE A BODY THE SIGNAL IS THE RUN'S OWN: a run asking for it is handed one the
// app's stop does not share, and the next run of the same value ends it — the work the first run
// started is owed to nobody.
//
// THE REVERTS: answer `STOPPING.signal` from `abortSignal` whatever runs, and `own: false, first
// after a rerun: false`; drop the `endRun` from `run`, and `first after a rerun: false`.
test('abortSignal in a memo body is its run’s own, ended by the next run — 7.22, 7.23', () => {
    const query = reactive('lead')
    const signals: AbortSignal[] = []
    const found = reactive(() => {
        const asked = query.get()
        signals.push(abortSignal())
        return asked
    })
    found.get()
    const first = signals[0] as AbortSignal
    const own = first !== abortSignal()
    query.set('won')
    found.get()
    expect(
        `own: ${own}, first after a rerun: ${first.aborted}, second: ${(signals[1] as AbortSignal).aborted}`,
    ).toBe('own: true, first after a rerun: true, second: false')
})

// 7.23 — A VALUE RELEASED ENDS ITS RUN'S SIGNAL: a `memo` its setup built, loading when that setup
// stops and read by nothing else (12.14), is owed to nobody, so the run it started is told to stop.
// THE REVERT: drop the `endRun` from `releaseOrphan`, and `released: false`.
test('a memo released while it loads ends the signal its run asked for — 7.23, 12.14', () => {
    let asked: AbortSignal | undefined
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const loading = reactive(() => {
        asked = abortSignal()
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

// 7.23 — 7.20'S ABORT REACHES A RUN THAT ASKED: a run still in flight when the app stops is told, as
// the app's own signal is. THE REVERT: drop the listener `abortSignal` adds on `STOPPING`, and
// `told: false`.
test('a run that asked for its signal is told when the app stops — 7.23', async () => {
    let asked: AbortSignal | undefined
    const feed = reactive(() => {
        asked = abortSignal()
        return givenUp(asked).catch(() => 0)
    })
    void feed.peek()
    const app = await inMemoryApp({})
    serving(app)
    while (asked === undefined) await Bun.sleep(1)
    await app.stop()
    expect(`told: ${asked.aborted}`).toBe('told: true')
})

// 7.24 — ON A SERVER THE RUN IS CARRIED ACROSS ITS `await`S: a body asking after one is handed its
// run's own signal, which the next run ends, and not the app's.
// THE REVERT: answer `BODY_RUN` in `abortSignal` whatever the provider, and `own: false, first after
// a rerun: false`.
test('on a server, abortSignal after an await in a memo body is still its run’s own — 7.24', async () => {
    const query = reactive('lead')
    const signals: AbortSignal[] = []
    const found = reactive(async () => {
        const asked = query.get()
        await Bun.sleep(0)
        signals.push(abortSignal())
        return asked
    })
    await found
    const first = signals[0] as AbortSignal
    const own = first !== appStopSignal()
    query.set('won')
    await found
    expect(
        `own: ${own}, first after a rerun: ${first.aborted}, second: ${(signals[1] as AbortSignal).aborted}`,
    ).toBe('own: true, first after a rerun: true, second: false')
})

// 7.24 — A CONTINUATION OF A RUN ALREADY OVER IS TOLD SO: it asks after the next run has started,
// and is handed a signal that already says stop rather than the run that replaced it.
// THE REVERT: drop the `runEpoch` test from `abortSignal`, and `late: false` — the late ask is
// handed the second run's signal.
test('a run asking after the next run started is handed a signal already aborted — 7.24', async () => {
    const query = reactive(1)
    let resume: () => void = () => undefined
    const asked: AbortSignal[] = []
    const found = reactive(async () => {
        const run = query.get()
        if (run === 1) await new Promise<void>((resolve) => (resume = resolve))
        asked[run] = abortSignal()
        return run
    })
    found.busy()
    query.set(2)
    await found
    resume()
    await Bun.sleep(0)
    expect(
        `late: ${(asked[1] as AbortSignal).aborted}, current: ${(asked[2] as AbortSignal).aborted}`,
    ).toBe('late: true, current: false')
})

// 7.23, 7.25 — A REQUEST IS AN OWNER: asked inside one, outside every run, the signal ends as the
// request does, and so does the signal of a run filed in it — after an `await` included.
// THE REVERTS: answer `undefined` from the provider's `requestSignal`, and `request: false, run:
// false`; hand `runSignal` `STOPPING.signal` whatever the scope, and `run: false`.
test('a request and a run filed in it end as the request does — 7.23, 7.25', async () => {
    const hangUp = new AbortController()
    const scope = scopeFor(
        new Request('http://crm.test/deals', { signal: hangUp.signal }),
        undefined,
        undefined,
    )
    let inRequest: AbortSignal | undefined
    let inRun: AbortSignal | undefined
    const deals = inOpenScope(scope, () => {
        inRequest = abortSignal()
        return reactive(async () => {
            await Bun.sleep(0)
            inRun = abortSignal()
            return 1
        })
    })
    await inOpenScope(scope, async () => await deals)
    const before = `${inRequest?.aborted} ${inRun?.aborted}`
    hangUp.abort()
    expect(
        `before: ${before}, request: ${inRequest?.aborted}, run: ${inRun?.aborted}`,
    ).toBe('before: false false, request: true, run: true')
})

// 7.26 — A BROWSER CARRIES NO RUN ACROSS AN `await`: the synchronous part is handed the run's own
// signal and the rest the app's, which is why a body reads it before its first `await`.
// THE REVERT: none to install — this is the absence 7.24 is the server's exception to; a provider
// left in place answers the run's own after the await, and `after the await: own`.
test('in a browser, abortSignal after an await in a memo body is the app’s — 7.26', async () => {
    const provider = SCOPING.provider
    SCOPING.provider = null
    try {
        let before: AbortSignal | undefined
        let after: AbortSignal | undefined
        const found = reactive(async () => {
            before = abortSignal()
            await Bun.sleep(0)
            after = abortSignal()
            return 1
        })
        await found
        expect(
            `before the await: ${before === appStopSignal() ? 'app' : 'own'}, after the await: ${after === appStopSignal() ? 'app' : 'own'}`,
        ).toBe('before the await: own, after the await: app')
    } finally {
        SCOPING.provider = provider
    }
})
