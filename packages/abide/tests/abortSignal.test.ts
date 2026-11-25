// `abortSignal` — A JOB TOLD TO STOP (RULEBOOK 7.38, 7.39), a run that gives up when it is told
// (4.12, 7.28, 37.28), and the owners between them: a run, carried across its `await`s on a server
// (7.45-7.47), and the request it is filed in (7.48). A file of its own: every job a file builds is filed for the process, and is
// started again by every app the file opens after it, so a count of warnings is only a count of
// these jobs' here.

import { expect, test } from 'bun:test'

import type { App, BootedApp } from '#server/createApp.ts'
import { inOpenScope, scopeFor } from '#server/requestScope.ts'
import { abortSignal, computed, log, reactive, watch } from '#shared'
import { appStopSignal } from '#shared/reactive/poll.ts'
import { SCOPING } from '#shared/reactive/scoping.ts'
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
test('a job giving up on abortSignal is not warned on, and a failing one still is — 4.12, 7.28, 37.28', async () => {
    const before = (log.records.peek() ?? []).length
    let landedRuns = 0
    const landed = computed(
        () => {
            landedRuns += 1
            return landedRuns === 1 ? 1 : givenUp(abortSignal())
        },
        { global: true, poll: 5 },
    )
    computed(() => givenUp(abortSignal()), { global: true, poll: 5 })
    computed(
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
test('abortSignal is aborted from the stop through its drain, and fresh once the stop resolves — 7.38, 7.39', async () => {
    let started = false
    let duringTheDrain: boolean | undefined
    computed(
        async () => {
            started = true
            await givenUp(abortSignal()).catch(() => undefined)
            // A turn past the abort, as a run winding down takes, and still inside the drain.
            await Bun.sleep(5)
            duringTheDrain = abortSignal().aborted
            return 0
        },
        { global: true, poll: 60_000 },
    )
    const app = await inMemoryApp({})
    serving(app)
    while (!started) await Bun.sleep(1)
    const told = abortSignal()
    await app.stop()
    expect(
        `told: ${told.aborted}, during the drain: ${duringTheDrain}, after the stop: ${abortSignal().aborted}`,
    ).toBe('told: true, during the drain: true, after the stop: false')
})

// 7.45, 7.46 — INSIDE A BODY THE SIGNAL IS THE RUN'S OWN: a run asking for it is handed one the
// app's stop does not share, and the next run of the same value ends it — the work the first run
// started is owed to nobody.
//
// THE REVERTS: answer `STOPPING.signal` from `abortSignal` whatever runs, and `own: false, first
// after a rerun: false`; drop the `endRun` from `run`, and `first after a rerun: false`.
test('abortSignal in a memo body is its run’s own, ended by the next run — 7.45, 7.46', () => {
    const query = reactive('lead')
    const signals: AbortSignal[] = []
    const found = computed(() => {
        const asked = query()
        signals.push(abortSignal())
        return asked
    })
    found()
    const first = signals[0] as AbortSignal
    const own = first !== abortSignal()
    query.set('won')
    found()
    expect(
        `own: ${own}, first after a rerun: ${first.aborted}, second: ${(signals[1] as AbortSignal).aborted}`,
    ).toBe('own: true, first after a rerun: true, second: false')
})

// 7.46 — A VALUE RELEASED ENDS ITS RUN'S SIGNAL: a `memo` its setup built, loading when that setup
// stops and read by nothing else (12.14), is owed to nobody, so the run it started is told to stop.
// THE REVERT: drop the `endRun` from `releaseOrphan`, and `released: false`.
test('a memo released while it loads ends the signal its run asked for — 7.46, 12.14', () => {
    let asked: AbortSignal | undefined
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    const loading = computed(() => {
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

// 7.46 — 7.38'S ABORT REACHES A RUN THAT ASKED: a run still in flight when the app stops is told, as
// the app's own signal is. THE REVERT: drop the listener `abortSignal` adds on `STOPPING`, and
// `told: false`.
test('a run that asked for its signal is told when the app stops — 7.46', async () => {
    let asked: AbortSignal | undefined
    computed(
        () => {
            asked = abortSignal()
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

// 7.47 — ON A SERVER THE RUN IS CARRIED ACROSS ITS `await`S: a body asking after one is handed its
// run's own signal, which the next run ends, and not the app's.
// THE REVERT: answer `BODY_RUN` in `abortSignal` whatever the provider, and `own: false, first after
// a rerun: false`.
test('on a server, abortSignal after an await in a memo body is still its run’s own — 7.47', async () => {
    const query = reactive('lead')
    const signals: AbortSignal[] = []
    const found = computed(async () => {
        const asked = query()
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

// 7.47 — A CONTINUATION OF A RUN ALREADY OVER IS TOLD SO: it asks after the next run has started,
// and is handed a signal that already says stop rather than the run that replaced it.
// THE REVERT: drop the `runEpoch` test from `abortSignal`, and `late: false` — the late ask is
// handed the second run's signal.
test('a run asking after the next run started is handed a signal already aborted — 7.47', async () => {
    const query = reactive(1)
    let resume: () => void = () => undefined
    const asked: AbortSignal[] = []
    const found = computed(async () => {
        const run = query()
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

// 7.46, 7.48 — A REQUEST IS AN OWNER: asked inside one, outside every run, the signal ends as the
// request does, and so does the signal of a run filed in it — after an `await` included.
// THE REVERTS: answer `undefined` from the provider's `requestSignal`, and `request: false, run:
// false`; hand `runSignal` `STOPPING.signal` whatever the scope, and `run: false`.
test('a request and a run filed in it end as the request does — 7.46, 7.48', async () => {
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
        return computed(async () => {
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

// 7.49 — A BROWSER CARRIES NO RUN ACROSS AN `await`: the synchronous part is handed the run's own
// signal and the rest the app's, which is why a body reads it before its first `await`.
// THE REVERT: none to install — this is the absence 7.47 is the server's exception to; a provider
// left in place answers the run's own after the await, and `after the await: own`.
test('in a browser, abortSignal after an await in a memo body is the app’s — 7.49', async () => {
    const provider = SCOPING.provider
    SCOPING.provider = null
    try {
        let before: AbortSignal | undefined
        let after: AbortSignal | undefined
        const found = computed(async () => {
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
