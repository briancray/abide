// `job` — WORK ON A SCHEDULE (54.18-54.27). A file of its own: every job a file builds is filed for
// the process and looked at again by every app the file opens after it (7.30), so each test stops
// the jobs it built that are still due.

import { expect, test } from 'bun:test'

import { job, type JobStatus, log, watch } from '#server'
import type { App, BootedApp } from '#server/createApp.ts'
import { type Reactive, reactive } from '#shared'

import { inMemoryApp } from './inMemoryApp.ts'

/** Runs `body` while an app is open, so every job's clock is running (7.30), and stops it after. */
async function serving(body: () => Promise<void>): Promise<void> {
    const app: App = await inMemoryApp({})
    ;(app as BootedApp).openMux()
    try {
        await body()
    } finally {
        await app.stop()
    }
}

/** Settles once `status` holds a status `holds` passes. */
function until(
    status: Reactive<JobStatus>,
    holds: (status: JobStatus) => boolean,
): Promise<void> {
    const reached = Promise.withResolvers<void>()
    const stop = watch(() => {
        if (holds(status())) reached.resolve()
    })
    return reached.promise.finally(stop)
}

// THE REVERT: start a run per `runNow` rather than joining the one in flight, and `runs` is 3.
test('a run asked for while one is in flight joins it — 54.20', async () => {
    let runs = 0
    const release = Promise.withResolvers<void>()
    const digest = job('joined', {
        every: 3_600_000,
        run: async () => {
            runs += 1
            await release.promise
        },
    })
    const asked = [digest.runNow(), digest.runNow(), digest.runNow()]
    expect(digest.status.peek()?.running).toBe(true)
    release.resolve()
    const [first, second, third] = await Promise.all(asked)
    expect(runs).toBe(1)
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(first?.running).toBe(false)
    expect(
        Date.parse(first?.nextRun ?? '') - Date.parse(first?.lastRun ?? ''),
    ).toBe(3_600_000)
})

// THE REVERT: measure from the end under `from: 'start'` too, and the next run is a full hour after
// the last one ended rather than after it started.
test('a job measured from the start names its next run an interval after the last run started — 54.29', async () => {
    const digest = job('fromStart', {
        every: 3_600_000,
        from: 'start',
        run: () => Bun.sleep(30),
    })
    const ran = await digest.runNow()
    const fromEnd =
        Date.parse(ran.nextRun ?? '') - Date.parse(ran.lastRun ?? '')
    expect(fromEnd).toBeLessThanOrEqual(3_600_000 - 25)
})

// THE REVERT: drop `global` from the status, and the request's run is the request's alone.
test('a run in a request writes the status every caller reads — 54.22', async () => {
    const digest = job('requested', { every: 3_600_000, run: () => {} })
    await using app = await inMemoryApp({})
    const ran = await app.run(() => digest.runNow())
    expect(digest.status.peek()).toEqual(ran)
    expect(ran.lastRun).not.toBe(null)
})

test('a failed run is logged under job:<name> and kept, and the next run clears it — 54.23', async () => {
    let fail = true
    const digest = job('failing', {
        every: 3_600_000,
        run: () => {
            if (fail) throw new Error('the mail server refused')
        },
    })
    const before = (log.records.peek() ?? []).length
    expect((await digest.runNow()).lastError).toBe('the mail server refused')
    const logged = (log.records.peek() ?? [])
        .slice(before)
        .filter((record) => record.namespace.endsWith('job:failing'))
    expect(logged.map((record) => record.level)).toEqual(['error'])
    fail = false
    expect((await digest.runNow()).lastError).toBe(null)
})

// THE REVERT: hand each look a run of its own rather than joining the one in flight, and `most` is 2.
test('a job never run runs once the app opens, and again each interval, one at a time — 54.18, 54.19, 54.20', async () => {
    let inFlight = 0
    let most = 0
    let runs = 0
    const ran = Promise.withResolvers<void>()
    const looked = job('looked', {
        every: 5,
        run: async () => {
            inFlight += 1
            most = Math.max(most, inFlight)
            // A run longer than the interval, so the clock looks while it is in flight.
            await Bun.sleep(15)
            inFlight -= 1
            runs += 1
            if (runs === 3) ran.resolve()
        },
    })
    await serving(async () => {
        // A run asked for between the clock's looks.
        void looked.runNow()
        await ran.promise
    })
    await looked.stop()
    expect(most).toBe(1)
})

test('a last run within the interval is waited out, and an older one is run at once — 54.21', async () => {
    let runs = 0
    const recent = job('recent', {
        every: 3_600_000,
        run: () => {
            runs += 1
        },
        lastRun: () => Date.now() - 60_000,
    })
    const stale = job('stale', {
        every: 3_600_000,
        run: () => {
            runs += 10
        },
        lastRun: () => Date.now() - 7_200_000,
    })
    await serving(async () => {
        await until(recent.status, (status) => status.nextRun !== null)
        await until(stale.status, (status) => status.lastRun !== null)
    })
    expect(runs).toBe(10)
    const nextRun = Date.parse(recent.status.peek()?.nextRun ?? '')
    expect(nextRun - Date.now()).toBeGreaterThan(3_400_000)
    await recent.stop()
})

// THE REVERT: drop the guard on a positive interval, and the paused job runs.
test('an interval of 0 runs nothing, and names no next run — 54.25', async () => {
    let runs = 0
    const looked = Promise.withResolvers<void>()
    const paused = job('paused', {
        every: () => 0,
        run: () => {
            runs += 1
        },
        // Asked on the first look, which goes on to run the job where it is due.
        lastRun: () => {
            looked.resolve()
            return undefined
        },
    })
    await serving(() => looked.promise)
    expect(runs).toBe(0)
    expect(paused.status.peek()?.nextRun).toBe(null)
    await paused.stop()
})

// THE REVERT: drop `stopping.signal` from the run's signal, and the run is never told — the stop
// waits on a run that never ends; drop the check in `runNow`, and `runs` is 2.
test('stop aborts the run in flight, waits on it, and starts no run after — 54.24, 54.26, 54.27', async () => {
    let runs = 0
    const started = Promise.withResolvers<void>()
    const digest = job('stopped', {
        every: 3_600_000,
        run: (signal) => {
            runs += 1
            started.resolve()
            return new Promise((_, fail) =>
                signal.addEventListener('abort', () =>
                    fail(new Error('told to stop')),
                ),
            )
        },
    })
    void digest.runNow()
    await started.promise
    const stopped = await digest.stop()
    expect(stopped).toMatchObject({
        running: false,
        lastRun: null,
        nextRun: null,
        lastError: null,
    })
    await digest.runNow()
    expect(runs).toBe(1)
})

// 54.26, 7.45 — A RUN OUTLIVES THE LOOK THAT STARTED IT: under `from: 'start'` a look does not wait
// on the run, so the looks after it are new runs of the job's own value — and a run handed that
// value's signal was aborted by the next look. THE REVERT: hand the run `stopSignal()` read in the
// look, and `aborted by a look: true`.
test('a run that overruns its interval is not aborted by the looks after it — 54.26, 54.29', async () => {
    const release = Promise.withResolvers<void>()
    let told: AbortSignal | undefined
    const scrape = job('overrun', {
        every: 5,
        from: 'start',
        run: async (signal) => {
            told ??= signal
            await release.promise
        },
    })
    await serving(async () => {
        await until(scrape.status, (status) => status.running)
        await Bun.sleep(40)
        const aborted = told?.aborted
        release.resolve()
        await scrape.stop()
        expect(`aborted by a look: ${aborted}`).toBe('aborted by a look: false')
    })
})

// 54.38 — WHILE `paused` READS TRUE A LOOK STARTS NO RUN, and `runNow` still does. THE REVERT: drop
// the pause from `look`, and `runs while paused: 1` or more.
test('a paused job starts no run from a look, and runNow still runs — 54.38', async () => {
    const paused = reactive(true)
    let runs = 0
    const sweep = job('paused', {
        every: 5,
        paused,
        run: () => {
            runs += 1
        },
    })
    await serving(async () => {
        await Bun.sleep(30)
        const whilePaused = runs
        await sweep.runNow()
        const asked = runs
        paused.set(false)
        await until(sweep.status, () => runs > asked)
        await sweep.stop()
        expect(`runs while paused: ${whilePaused}, asked: ${asked}`).toBe(
            'runs while paused: 0, asked: 1',
        )
    })
})
