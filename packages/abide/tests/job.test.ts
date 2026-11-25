// `job` — WORK ON A SCHEDULE (54.14-54.23). A file of its own: every job a file builds is filed for
// the process and looked at again by every app the file opens after it (7.30), so each test stops
// the jobs it built that are still due.

import { expect, test } from 'bun:test'

import { job, type JobStatus, log } from '#server'
import type { App, BootedApp } from '#server/createApp.ts'
import { inOpenScope, scopeFor } from '#server/requestScope.ts'
import {
    abortSignal,
    type Memo,
    pipe,
    reactive,
    refuse,
    type Store,
} from '#shared'

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
/** A store holding a job's status as a last run that ended at `lastRun`, calling `asked` as it is read. */
function kept(
    lastRun: number | undefined,
    asked: () => void = () => undefined,
): Store<JobStatus> {
    return {
        get: () => {
            asked()
            return {
                running: false,
                lastRun:
                    lastRun === undefined
                        ? null
                        : new Date(lastRun).toISOString(),
                lastTook: null,
                lastResult: undefined,
                nextRun: null,
                lastError: null,
            }
        },
        set: () => undefined,
    }
}

async function until(
    status: Memo<undefined, JobStatus>,
    holds: (status: JobStatus) => boolean,
): Promise<void> {
    const reader = status.readable().getReader()
    try {
        for (;;) {
            const { value, done } = await reader.read()
            if (done || holds(value)) return
        }
    } finally {
        await reader.cancel()
    }
}

// THE REVERT: start a run per `Job.run` rather than joining the one in flight, and `handed` is
// [1, 2, 3].
test('a run asked for while one is in flight joins it, and its input reaches no run — 54.16', async () => {
    const handed: (number | undefined)[] = []
    const release = Promise.withResolvers<void>()
    const digest = job({
        name: 'joined',
        every: 3_600_000,
        run: async (input?: number) => {
            handed.push(input)
            await release.promise
        },
    })
    const asked = [digest.run(1), digest.run(2), digest.run(3)]
    expect((await digest.status())?.running).toBe(true)
    release.resolve()
    const [first, second, third] = await Promise.all(asked)
    expect(`handed: ${handed.join(', ')}`).toBe('handed: 1')
    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(first?.running).toBe(false)
    expect(
        Date.parse(first?.nextRun ?? '') - Date.parse(first?.lastRun ?? ''),
    ).toBe(3_600_000)
})

// THE REVERT: call `run` with `undefined` whoever started it, and `handed` reads `undefined` twice.
test('Job.run hands the run its input, and a look hands it undefined — 54.22', async () => {
    const handed: ({ limit: number } | undefined)[] = []
    const imported = job({
        name: 'handed',
        every: 3_600_000,
        run: (options?: { limit: number }) => {
            handed.push(options)
        },
    })
    await serving(async () => {
        await until(imported.status, (status) => status.lastRun !== null)
        await imported.run({ limit: 3 })
        await imported.stop()
    })
    expect(handed).toEqual([undefined, { limit: 3 }])
})

// THE REVERT: measure from the end under `from: 'start'` too, and the next run is a full hour after
// the last one ended rather than after it started.
test('a job measured from the start names its next run an interval after the last run started — 54.25', async () => {
    const digest = job({
        name: 'fromStart',
        every: 3_600_000,
        from: 'start',
        run: () => Bun.sleep(30),
    })
    const ran = await digest.run()
    const fromEnd =
        Date.parse(ran.nextRun ?? '') - Date.parse(ran.lastRun ?? '')
    expect(fromEnd).toBeLessThanOrEqual(3_600_000 - 25)
})

// THE REVERT: drop `global` from the status, and the request's run is the request's alone.
test('a run in a request writes the status every caller reads — 54.18', async () => {
    const digest = job({ name: 'requested', every: 3_600_000, run: () => {} })
    await using app = await inMemoryApp({})
    const ran = await app.run(() => digest.run())
    expect(await digest.status()).toEqual(ran)
    expect(ran.lastRun).not.toBe(null)
})

test('a failed run rejects, is logged under job:<name> and kept, and the next run clears it — 54.19, 54.39', async () => {
    let fail = true
    const digest = job({
        name: 'failing',
        every: 3_600_000,
        run: () => {
            if (fail) throw new Error('the mail server refused')
        },
    })
    const before = (log.records.peek() ?? []).length
    const thrown = await digest.run().catch((error: Error) => error.message)
    expect(
        `rejected: ${thrown}, kept: ${(await digest.status())?.lastError}`,
    ).toBe('rejected: the mail server refused, kept: the mail server refused')
    const logged = (log.records.peek() ?? [])
        .slice(before)
        .filter((record) => record.namespace.endsWith('job:failing'))
    expect(logged.map((record) => record.level)).toEqual(['error'])
    fail = false
    expect((await digest.run()).lastError).toBe(null)
})

test('a failed run of a job given no name is logged under job — 54.19', async () => {
    const unnamed = job({
        every: 3_600_000,
        run: () => {
            throw new Error('the mail server refused')
        },
    })
    const before = (log.records.peek() ?? []).length
    await unnamed.run().catch(() => undefined)
    const logged = (log.records.peek() ?? [])
        .slice(before)
        .map((record) => record.namespace)
    await unnamed.stop()
    expect(logged).toEqual(['app:job'])
})

// THE REVERT: hand each look a run of its own rather than joining the one in flight, and `most` is 2.
test('a job never run runs once the app opens, and again each interval, one at a time — 54.14, 54.15, 54.16', async () => {
    let inFlight = 0
    let most = 0
    let runs = 0
    const ran = Promise.withResolvers<void>()
    const looked = job({
        name: 'looked',
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
        void looked.run()
        await ran.promise
    })
    await looked.stop()
    expect(most).toBe(1)
})

test('a last run within the interval is waited out, and an older one is run at once — 54.17', async () => {
    let runs = 0
    const recent = job({
        name: 'recent',
        every: 3_600_000,
        run: () => {
            runs += 1
        },
        store: kept(Date.now() - 60_000),
    })
    const stale = job({
        name: 'stale',
        every: 3_600_000,
        run: () => {
            runs += 10
        },
        store: kept(Date.now() - 7_200_000),
    })
    await serving(async () => {
        await until(recent.status, (status) => status.nextRun !== null)
        await until(stale.status, (status) => status.lastRun !== null)
    })
    expect(runs).toBe(10)
    const nextRun = Date.parse((await recent.status())?.nextRun ?? '')
    expect(nextRun - Date.now()).toBeGreaterThan(3_400_000)
    await recent.stop()
})

// THE REVERT: drop the guard on a positive interval, and the paused job runs.
test('an interval of 0 runs nothing, and names no next run — 54.21', async () => {
    let runs = 0
    const looked = Promise.withResolvers<void>()
    const paused = job({
        name: 'paused',
        every: () => 0,
        run: () => {
            runs += 1
        },
        // Read on the first look, which goes on to run the job where it is due.
        store: kept(undefined, () => looked.resolve()),
    })
    await serving(() => looked.promise)
    expect(runs).toBe(0)
    expect((await paused.status())?.nextRun).toBe(null)
    await paused.stop()
})

// THE REVERT: drop `stopping.signal` from the run's signal, and the run is never told — the stop
// waits on a run that never ends; drop the check in `Job.run`, and `runs` is 2.
test('stop aborts the run in flight, waits on it, and starts no run after — 54.20, 54.22, 54.23', async () => {
    let runs = 0
    const started = Promise.withResolvers<void>()
    const digest = job({
        name: 'stopped',
        every: 3_600_000,
        run: () => {
            const signal = abortSignal()
            runs += 1
            started.resolve()
            return new Promise((_, fail) =>
                signal.addEventListener('abort', () =>
                    fail(new Error('told to stop')),
                ),
            )
        },
    })
    void digest.run()
    await started.promise
    const stopped = await digest.stop()
    expect(stopped).toMatchObject({
        running: false,
        lastRun: null,
        nextRun: null,
        lastError: null,
    })
    await digest.run()
    expect(runs).toBe(1)
})

// 54.22, 7.45 — A RUN OUTLIVES THE LOOK THAT STARTED IT: under `from: 'start'` a look does not wait
// on the run, so the looks after it are new runs of the job's own value — and a run whose signal
// was that value's was aborted by the next look. THE REVERT: call `run` outside `ownedBy`, so
// `abortSignal()` in it is the look's, and `aborted by a look: true`.
test('a run that overruns its interval is not aborted by the looks after it — 54.22, 54.25', async () => {
    const release = Promise.withResolvers<void>()
    let told: AbortSignal | undefined
    const scrape = job({
        name: 'overrun',
        every: 5,
        from: 'start',
        run: async () => {
            told ??= abortSignal()
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

// 54.34 — WHILE `paused` READS TRUE A LOOK STARTS NO RUN, and `Job.run` still does. THE REVERT: drop
// the pause from `look`, and `runs while paused: 1` or more.
test('a paused job starts no run from a look, and Job.run still runs — 54.34', async () => {
    const paused = reactive(true)
    let runs = 0
    const sweep = job({
        name: 'paused',
        every: 5,
        paused,
        run: () => {
            runs += 1
        },
    })
    await serving(async () => {
        await Bun.sleep(30)
        const whilePaused = runs
        await sweep.run()
        const asked = runs
        paused.set(false)
        await until(sweep.status, () => runs > asked)
        await sweep.stop()
        expect(`runs while paused: ${whilePaused}, asked: ${asked}`).toBe(
            'runs while paused: 0, asked: 1',
        )
    })
})

// 54.35 — A RUN IS ITS OWN OWNER: `abortSignal()` inside it, after an `await` included, answers the
// run's signal — not the request `Job.run` was called from, which ends as its caller hangs up.
test('abortSignal in a run asked for from a request outlives the request, and ends at stop — 54.35', async () => {
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    let inside: AbortSignal | undefined
    const exporting = job({
        name: 'owned',
        every: 3_600_000,
        run: async () => {
            await Bun.sleep(0)
            inside = abortSignal()
            started.resolve()
            await release.promise
        },
    })
    const hangUp = new AbortController()
    const scope = scopeFor(
        new Request('http://crm.test/export', { signal: hangUp.signal }),
        undefined,
        undefined,
    )
    const ran = inOpenScope(scope, () => exporting.run())
    await started.promise
    hangUp.abort()
    const afterHangUp = inside?.aborted
    const stopping = exporting.stop()
    release.resolve()
    await Promise.all([ran, stopping])
    expect(
        `after hang up: ${afterHangUp}, after stop: ${inside?.aborted}`,
    ).toBe('after hang up: false, after stop: true')
})

// 54.35 — nor the look that started it, which the next look replaces under `from: 'start'`.
test('abortSignal in a run that overruns its interval is not aborted by the looks after it — 54.35', async () => {
    const release = Promise.withResolvers<void>()
    let inside: AbortSignal | undefined
    const scrape = job({
        name: 'owned overrun',
        every: 5,
        from: 'start',
        run: async () => {
            await Bun.sleep(0)
            inside ??= abortSignal()
            await release.promise
        },
    })
    await serving(async () => {
        await until(scrape.status, (status) => status.running)
        await Bun.sleep(40)
        const aborted = inside?.aborted
        release.resolve()
        await scrape.stop()
        expect(`aborted by a look: ${aborted}`).toBe('aborted by a look: false')
    })
})

// 54.35, 57.13 — A PIPE CALLED IN A RUN IS HANDED NO SIGNAL and still ends with the job: it reads
// `abortSignal` where it is called, and that is the run's. THE REVERT: call `run` outside `ownedBy`,
// and the step is told nothing at stop — `stop` waits on it past the test's deadline.
test('a pipe called in a run is told to stop when the job stops — 54.35, 57.13', async () => {
    const started = Promise.withResolvers<void>()
    let told = false
    const nightly = pipe([
        (_item: undefined, signal: AbortSignal) =>
            new Promise<void>((resolve) => {
                started.resolve()
                signal.addEventListener('abort', () => {
                    told = true
                    resolve()
                })
            }),
    ])
    const scheduled = job({
        name: 'piped',
        every: 3_600_000,
        run: () => nightly(undefined),
    })
    void scheduled.run()
    await started.promise
    await scheduled.stop()
    expect(`step told: ${told}`).toBe('step told: true')
})

// 54.36 — A CRON JOB NEVER RUN WAITS FOR ITS FIRST TIME, where an `every` job runs as the app opens,
// and times missed since its last run are caught up with ONE run. THE REVERT: drop the first look's
// `Date.now()` for a cron job, and `waiting` runs as the app opens — `runs` is 1 where 0 is due.
test('a cron job never run waits for its first time, and missed times run once — 54.36', async () => {
    let runs = 0
    let caughtUp = 0
    const waiting = job({
        name: 'new year',
        cron: '0 0 1 1 *',
        run: () => {
            runs += 1
        },
    })
    // Three new years missed since the last run, and one run for all of them.
    const behind = job({
        name: 'missed new years',
        cron: '0 0 1 1 *',
        run: () => {
            caughtUp += 1
        },
        store: kept(Date.now() - 3 * 366 * 86_400_000),
    })
    await serving(async () => {
        await until(waiting.status, (status) => status.nextRun !== null)
        await until(behind.status, (status) => status.lastRun !== null)
        // Two looks more, so a second run of the missed times would have started.
        await Bun.sleep(2_100)
    })
    expect(runs).toBe(0)
    expect((await waiting.status()).nextRun as string | null | undefined).toBe(
        Bun.cron.parse('0 0 1 1 *', Date.now())?.toISOString(),
    )
    expect(caughtUp).toBe(1)
    expect((await behind.status()).nextRun as string | null | undefined).toBe(
        Bun.cron.parse('0 0 1 1 *', Date.now())?.toISOString(),
    )
    await waiting.stop()
    await behind.stop()
})

// 54.37 — `timeZone` IS WHERE THE CRON'S CLOCK IS READ. THE REVERT: drop `tz` from the parse, and
// the next run is 2:00 on the server's clock rather than Kiritimati's, fourteen hours past UTC.
test('a cron job reads its times in its timeZone — 54.37', async () => {
    const nightly = job({
        name: 'kiritimati nightly',
        cron: '0 2 * * *',
        timeZone: 'Pacific/Kiritimati',
        run: () => {},
    })
    await serving(async () => {
        await until(nightly.status, (status) => status.nextRun !== null)
    })
    const nextRun = new Date((await nightly.status())?.nextRun ?? '')
    const hour = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Pacific/Kiritimati',
        hour: 'numeric',
        minute: 'numeric',
        hourCycle: 'h23',
    }).format(nextRun)
    expect(hour).toBe('02:00')
    await nightly.stop()
})

test('a job given both every and cron, neither, or a cron that does not parse throws — 54.38', () => {
    const run = () => {}
    expect(() =>
        job({ every: 1_000, cron: '* * * * *', run } as never),
    ).toThrow(TypeError)
    expect(() => job({ run } as never)).toThrow(TypeError)
    expect(() => job({ cron: 'every night', run })).toThrow()
})

// 54.39 — A RUN ANSWERING A REFUSAL FAILED, as one throwing did: `Job.run` rejects with it, and the
// status keeps its message. THE REVERT: drop the `isFailed` test from `runOnce`; the run resolves and
// `lastError: null`.
test('a run answering a refusal rejects and is kept as a failure — 54.39', async () => {
    const digest = job({
        every: 3_600_000,
        run: () => refuse(503, 'the mail server is down'),
    })
    const status = await digest
        .run()
        .catch((refusal: { status?: number }) => refusal.status)
    expect(
        `rejected: ${status}, lastError: ${(await digest.status())?.lastError}`,
    ).toBe('rejected: 503, lastError: the mail server is down')
    await digest.stop()
})

// 54.41 — A RUN RECORDS HOW LONG IT TOOK AND WHAT IT ANSWERED, and a failed run keeps the last good
// answer beside its error. THE REVERT: write `lastResult` from every run in `runOnce`; the failed run
// leaves `lastResult: undefined` where `report 1` is due.
test('a run records how long it took, and the last good answer survives a failure — 54.41', async () => {
    let fail = false
    const report = job({
        every: 3_600_000,
        run: async () => {
            await Bun.sleep(20)
            if (fail) throw new Error('down')
            return 'report 1'
        },
    })
    await report.run()
    const ok = await report.status()
    fail = true
    await report.run().catch(() => undefined)
    const failed = await report.status()
    expect(
        `took: ${(ok.lastTook ?? 0) >= 20}, result: ${failed.lastResult}, error: ${failed.lastError}`,
    ).toBe('took: true, result: report 1, error: down')
    await report.stop()
})

// 54.17, 54.42 — A JOB OPENS ON WHAT ITS STORE KEPT: a status written while a run was going is read as no
// run going, a last run inside the interval is waited out rather than run again at once, and the last
// good result comes back. THE REVERT: drop the store read from the first look; the job counts from no
// last run, runs at once, and `runs: 1`.
test('a job opens on its stored status and waits out its stored last run — 54.17, 54.42', async () => {
    let runs = 0
    const stored: { value: JobStatus } = {
        value: {
            running: true,
            lastRun: new Date(Date.now() - 60_000).toISOString(),
            lastTook: 12,
            lastResult: 'sent 3',
            nextRun: null,
            lastError: null,
        },
    }
    const resumed = job({
        name: 'resumed',
        every: 3_600_000,
        run: () => {
            runs += 1
            return `sent ${runs}`
        },
        store: {
            get: () => stored.value,
            set: (value) => {
                stored.value = value
            },
        },
    })
    await serving(() =>
        until(resumed.status, (status) => status.nextRun !== null),
    )
    const now = await resumed.status()
    expect(
        `result: ${now.lastResult}, runs: ${runs}, running: ${now.running}, waits: ${Date.parse(now.nextRun ?? '') - Date.now() > 3_400_000}`,
    ).toBe('result: sent 3, runs: 0, running: false, waits: true')
    await resumed.stop()
})
