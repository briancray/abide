// `poll` — A REFRESH ON A CLOCK (RULEBOOK 7.20 through 7.28). Every claim is a count of body runs:
// a poll that kept running past its value, or one that superseded its own load, still serves a
// right-looking value.

import { expect, test } from 'bun:test'

import { spawned } from '@abide/harness/gate'

import type { App, BootedApp } from '#server/createApp.ts'
import { log, reactive } from '#shared'
import { collectWatches } from '#shared/reactive/watch.ts'

import { inMemoryApp } from './inMemoryApp.ts'

/** What `App.listen` and `abide dev` open, with no socket to bind here (7.30). */
function serving(app: App): void {
    ;(app as BootedApp).openMux()
}

/** Runs `build` as a component's setup is run, and answers what ends it. */
function inSetup(build: () => void): () => void {
    const stops: (() => void)[] = []
    const previous = collectWatches(stops)
    build()
    collectWatches(previous)
    return () => {
        for (const stop of stops) stop()
    }
}

// 7.20 AND 7.23: THE BODY RUNS ON THE CLOCK, AND STOPS WITH ITS OWNER. A value built in a setup is
// refreshed every `poll` while the setup stands, and never once it has ended.
//
// THE REVERT: drop the `owned(...)` from `ownedPoll`, and `after the owner ended: 5` where `0`
// is due.
test('poll runs the body on its interval and stops with the owner that built it — 7.20, 7.23', async () => {
    let runs = 0
    const end = inSetup(() => {
        reactive(
            () => {
                runs += 1
                return runs
            },
            { poll: 15 },
        )
    })
    expect(`at construction: ${runs}`).toBe('at construction: 1')
    await Bun.sleep(100)
    expect(runs).toBeGreaterThanOrEqual(3)
    end()
    const atEnd = runs
    await Bun.sleep(60)
    expect(`after the owner ended: ${runs - atEnd}`).toBe(
        'after the owner ended: 0',
    )
})

// 7.21: A POLL OVER A LOAD IN FLIGHT WAITS FOR IT. A refresh supersedes the load it finds, so a
// producer slower than its interval polled blindly never lands at all.
//
// THE REVERT: have `refreshIdle` refresh unconditionally, and `ready: false` with every run
// superseded, where `ready: true` is due.
test('poll does not refresh a value whose load is still in flight — 7.21', async () => {
    let runs = 0
    let slowValue: { ready(): boolean } | undefined
    const end = inSetup(() => {
        const slow = reactive(
            async () => {
                runs += 1
                await Bun.sleep(40)
                return runs
            },
            { poll: 5 },
        )
        slowValue = slow
    })
    await Bun.sleep(150)
    end()
    expect(`ready: ${slowValue?.ready()}`).toBe('ready: true')
    // ~150 / 45 loads, where a blind poll would start one per 5 ms.
    expect(runs).toBeLessThanOrEqual(6)
})

// 7.20 AND 7.23 ON A KEYED VALUE: ONE CLOCK OVER THE ENTRIES IT HOLDS, stopped with the `Keyed`.
//
// THE REVERT: drop the `owned(...)` from `ownedPoll`, and each entry ran 3 more times after it
// ended, `after: 10,10` where `7,7` was due.
test('poll on a keyed value refreshes every entry it holds, and stops with it — 7.20, 7.23', async () => {
    const runs = new Map<number, number>()
    const end = inSetup(() => {
        const row = reactive(
            (args: { id: number }) => {
                runs.set(args.id, (runs.get(args.id) ?? 0) + 1)
                return args.id
            },
            { poll: 15 },
        )
        row({ id: 1 })
        row({ id: 2 })
    })
    await Bun.sleep(100)
    expect(runs.get(1)).toBeGreaterThanOrEqual(3)
    expect(runs.get(2)).toBeGreaterThanOrEqual(3)
    end()
    const atEnd = [runs.get(1), runs.get(2)].join(',')
    await Bun.sleep(60)
    expect(`after: ${[runs.get(1), runs.get(2)].join(',')}`).toBe(
        `after: ${atEnd}`,
    )
})

// 7.25: A POLL OF NOTHING IS A REFRESH PER TURN, and refused where the value is built.
test('a poll that is not a positive number is refused at construction — 7.25', () => {
    expect(() => reactive(() => 1, { poll: 0 })).toThrow(
        'A poll is a positive number of milliseconds',
    )
    expect(() =>
        reactive((args: { id: number }) => args.id, { poll: -1 }),
    ).toThrow('A poll is a positive number of milliseconds')
})

// 7.22: A POLLED VALUE NOBODY ENDS DOES NOT KEEP THE PROCESS ALIVE. A module-level value polls for
// the life of the process, and a script or a test run that builds one still exits.
//
// THE REVERT: drop the `unref` from `ownedPoll`, and the child never exits — `did not finish in 5000 ms`.
test('a poll does not hold the process open — 7.22', async () => {
    const source = `import { reactive } from '${import.meta.dir}/../src/shared/index.ts'
reactive(() => 1, { poll: 50, global: true })()
reactive((args: { id: number }) => args.id, { poll: 50 })({ id: 1 })()`
    const ran = await spawned(['bun', '-e', source], { deadline: 5_000 })
    expect(`exit: ${ran.exitCode}`, ran.stderr).toBe('exit: 0')
}, 10_000)

// A JOB IS A POLLED VALUE NO OWNER ENDS — one runs at a time, says when it is running, repeats on a
// clock, logs a run that failed and goes on, and stops with the app, waiting out the run it has. Two
// arms over one contract: the loop an app writes by hand (media's `scheduleLoop`, with its `stop`
// awaited from `onStop`) and `reactive(…, { global: true, poll })` stopped by `App.stop`. Every
// claim is a count — a job that overlapped itself or ran past the stop still leaves the right
// value behind.

type Job = { runs: number; ended: number; overlapped: number; failed: string }

/** A run of `ms` per step over three steps, failing on its second run — as a scrape does. */
async function* scrapeRun(job: Job, ms: number): AsyncGenerator<number> {
    job.runs += 1
    const run = job.runs
    if (job.runs - job.ended > 1) job.overlapped += 1
    try {
        if (run === 2) throw new Error(`run ${run} failed`)
        for (let step = 0; step < 3; step += 1) {
            await Bun.sleep(ms)
            yield step
        }
    } finally {
        job.ended += 1
    }
}

/** The vanilla arm: media's `scheduleLoop`, ported whole — a run, then the next one interval after it settles. */
function scheduleLoop(
    task: () => Promise<unknown>,
    interval: number,
): () => Promise<void> {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let running: Promise<unknown> = Promise.resolve()
    const run = (): void => {
        running = task()
            .catch((error) => log.error(error))
            .finally(() => {
                if (!stopped) timer = setTimeout(run, interval)
            })
    }
    run()
    return async () => {
        stopped = true
        clearTimeout(timer)
        await running
    }
}

const ARMS: Record<string, (job: Job) => Promise<() => Promise<void>>> = {
    async vanilla(job) {
        return scheduleLoop(async () => {
            for await (const _ of scrapeRun(job, 15));
        }, 10)
    },
    async abide(job) {
        reactive(() => scrapeRun(job, 15), { global: true, poll: 10 })
        const app = await inMemoryApp({})
        serving(app)
        return () => app.stop()
    },
}

// 4.12, 7.20, 7.21, 7.26, 7.27, 7.28 — THE CONTRACT, both arms. A run in flight when the stop is asked is
// waited on, and none starts after it.
//
// THE REVERTS, on the abide arm: drop `stopUnownedPolls` from `stopOnce`, and `ended at the stop:
// false, runs after the stop: 2`; drop `warnFailure` from `refused`, and `warned: 0` — the second run
// fails over the first one's value, so it is a failed revalidation (4.12) that warns, and 7.28 does not
// warn a second time.
for (const [arm, start] of Object.entries(ARMS))
    test(`a job runs one at a time, logs a failed run and goes on, and stops with the app waiting on its run — ${arm}, 4.12, 7.20, 7.21, 7.26, 7.27, 7.28`, async () => {
        const job: Job = { runs: 0, ended: 0, overlapped: 0, failed: '' }
        const before = (log.records.peek() ?? []).length
        const stop = await start(job)
        await Bun.sleep(170)
        expect(`overlapped: ${job.overlapped}`).toBe('overlapped: 0')
        // Past the failed second run, so the clock outlived the failure.
        expect(job.runs).toBeGreaterThanOrEqual(3)
        const warned = (log.records.peek() ?? [])
            .slice(before)
            .filter((record) => record.message.includes('run 2 failed'))
        expect(`warned: ${warned.length}`).toBe('warned: 1')
        // Mid-run, so there is a run in flight for the stop to wait on.
        while (job.runs === job.ended) await Bun.sleep(1)
        await stop()
        const endedAtStop = job.runs === job.ended
        const atStop = job.runs
        await Bun.sleep(80)
        expect(
            `ended at the stop: ${endedAtStop}, runs after the stop: ${job.runs - atStop}`,
        ).toBe('ended at the stop: true, runs after the stop: 0')
    })

// 7.28 ON A KEYED VALUE: each entry is marked before its first run, so a first run that throws where
// the entry is reached is warned on as a polled one is.
//
// THE REVERT: take `poll` off the entries' options in `createKeyed` again, and `warned: 0`.
test('a keyed polled entry whose first run fails is warned on abide:reactive — 7.28', () => {
    const before = (log.records.peek() ?? []).length
    const end = inSetup(() => {
        const row = reactive(
            (args: { id: number }): number => {
                throw new Error(`row ${args.id} could not be read`)
            },
            { poll: 1_000 },
        )
        row({ id: 7 })
    })
    end()
    const warned = (log.records.peek() ?? [])
        .slice(before)
        .filter(
            (record) =>
                record.namespace === 'abide:reactive' &&
                record.message.includes('row 7 could not be read'),
        )
    expect(`warned: ${warned.length}`).toBe('warned: 1')
})

// 7.29, 7.30, 7.31 — A JOB WAITS FOR THE APP. Every claim is a count of body runs: a job that ran at import
// still serves the right value, and costs every test that boots and stops an app one run each.

/** A job counting its runs, built where nothing owns it — as a module's is. */
function countedJob(): { runs: () => number; value: { busy(): boolean } } {
    let runs = 0
    const value = reactive(
        async () => {
            runs += 1
            await Bun.sleep(5)
            return runs
        },
        { global: true, poll: 60_000 },
    )
    return { runs: () => runs, value }
}

// THE REVERT: start the producer at construction again (drop the `job` arm in `createReactive`), and
// `runs: 1` — the run at import, which every stop then waits on.
test('apps booted and stopped before anything reads a job never run it — 7.29, 7.31', async () => {
    const job = countedJob()
    for (let cycle = 0; cycle < 5; cycle += 1) {
        const app = await inMemoryApp({})
        await app.stop()
    }
    expect(`runs: ${job.runs()}`).toBe('runs: 0')
})

// THE REVERT: drop `firstRunStarted` from `reloadOwed`, so the read leaves the job still held, and
// the app opening runs it again — `after opening: 2`.
test('a read before the app opens runs a job once, and the app opening does not run it again — 7.30', async () => {
    let runs = 0
    const value = reactive(
        async () => {
            runs += 1
            return runs
        },
        { global: true, poll: 20 },
    )
    expect(`before: ${runs}`).toBe('before: 0')
    expect(await value).toBe(1)
    const app = await inMemoryApp({})
    serving(app)
    expect(`after opening: ${runs}`).toBe('after opening: 1')
    await Bun.sleep(30)
    await app.stop()
    expect(runs).toBeGreaterThanOrEqual(2)
})

// THE REVERT: have `startUnownedPolls` refresh every job it finds, run or not, and the second
// opening supersedes the first run — `runs: 2`.
test('the app opening makes a job’s first run, once — 7.30', async () => {
    const job = countedJob()
    const app = await inMemoryApp({})
    serving(app)
    serving(app)
    expect(`busy: ${job.value.busy()}, runs: ${job.runs()}`).toBe(
        'busy: true, runs: 1',
    )
    await app.stop()
    expect(`after the stop: ${job.value.busy()}`).toBe('after the stop: false')
})
