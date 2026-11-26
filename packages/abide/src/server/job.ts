// WORK ON A SCHEDULE: 54.14-54.23. A job looks whether a run is due on a clock of its own, which an
// app opening to the network starts and `App.stop` stops and waits on (54.14, 54.43). What it keeps
// is the bookkeeping written once: a status a handler can answer, one run at a time, and when the
// last run ended. Work that must happen whether or not anything follows a value is a job writing a
// `memo` — a `memo`'s `ttl` refreshes only what something follows (6.1).

import { isFailed } from '#shared/Failed.ts'
import { log } from '#shared/log.ts'
import { messageOf } from '#shared/messageOf.ts'
import { appStopSignal } from '#shared/reactive/abortSignal.ts'
import { armTimer } from '#shared/reactive/armTimer.ts'
import {
    type Memo,
    memo,
    type Reactive,
    type Store,
} from '#shared/reactive/index.ts'

import { ownedBy } from './requestScope.ts'

/** 54.18 — where a job stands, as a page reads it through a handler. */
export type JobStatus = {
    /** Whether a run is going. */
    running: boolean
    /** When the last run ended, as an ISO time, or `null` before one has. */
    lastRun: string | null
    /** When the next run is due, as an ISO time, or `null` while none is. */
    nextRun: string | null
    /** How long the last run took, in milliseconds, or `null` before one has ended. */
    lastTook: number | null
    /** What the last run that did not fail answered, or `undefined` before one has. */
    lastResult: unknown
    /** The last run's failure, or `null` where it ended without throwing. */
    lastError: string | null
}

/** One run's ending: the status it wrote, and what it threw or refused, where it failed. */
type Ran = { status: JobStatus; failure: unknown }

/** 54.14 — a job's status beside the ways to run it ahead of its schedule and to end it. */
export type Job<Input = undefined> = {
    status: Memo<undefined, JobStatus>
    run: (input?: Input) => Promise<JobStatus>
    stop: () => Promise<JobStatus>
}

/** 54.14 — what a job is: its name, its schedule, its work, and what holds or remembers it. */
export type JobOptions<Input = undefined> = {
    /** 54.19 — what a failed run is logged under, beside `job`. */
    name?: string | undefined
    /** 54.22, 54.35 — the work, handed what `Job.run` was given and `undefined` where a look started it; `abortSignal()` in it says stop. */
    run: (input: Input | undefined) => unknown
    /** 54.17 — where the status is kept, so a restart resumes the schedule and keeps the last run's result. */
    store?: Store<JobStatus> | undefined
    /** 54.44 — the milliseconds after the app opens that the first look waits, rather than looking at once. */
    delay?: number | undefined
    /** 54.34 — what holds the schedule: while it reads true, a look starts no run. */
    paused?:
        Reactive<boolean, never, never, boolean> | (() => boolean) | undefined
} & (
    | {
          /** 54.14, 54.15, 54.21 — the milliseconds between the end of one run and the next, or between their starts under `from`, read at each look where a function. */
          every: number | (() => number)
          /** 54.25 — whether `every` is measured from when the last run `'end'`ed, the default, or from when it `'start'`ed. */
          from?: 'end' | 'start' | undefined
          cron?: never | undefined
          timeZone?: never | undefined
      }
    | {
          /** 54.36, 54.37 — the times a run is due, as a five-field cron expression or a nickname such as `@daily`. */
          cron: string
          /** 54.37 — the IANA zone `cron` is read in, where it is not the server's own. */
          timeZone?: string | undefined
          every?: never | undefined
          from?: never | undefined
      }
)

/**
 * A job's clock, as the app opening and stopping drives it: started by `App.listen` and `abide dev`,
 * stopped by `App.stop`, which then waits on the run in flight (54.14, 54.43).
 */
type Clock = {
    start: () => void
    halt: () => void
    inFlight: () => Promise<unknown> | undefined
}

/** Every job built in the process, each looked at again by every app that opens after it (42.12). */
const CLOCKS = new Set<Clock>()

/** 54.14 — the app opened to the network: every job's first look, and its clock from there. */
export function startJobs(): void {
    for (const clock of CLOCKS) clock.start()
}

/**
 * 54.14, 54.43 — every job's clock stopped, answering what waits on each run in flight, asked once
 * the requests have drained so a run a request started is waited on too.
 */
export function stopJobs(): () => Promise<void> {
    for (const clock of CLOCKS) clock.halt()
    return async () => {
        const inFlight: Promise<unknown>[] = []
        for (const clock of CLOCKS) {
            const running = clock.inFlight()
            if (running !== undefined) inFlight.push(running)
        }
        await Promise.all(inFlight)
    }
}

/** The longest a job waits between two looks at whether a run is due (54.14). */
const LONGEST_LOOK = 60_000

/** 54.36 — how often a `cron` job looks, so a run starts within a second of the time it is due. */
const CRON_LOOK = 1_000

/** Work run every `every` milliseconds on the server, one run at a time: 54.14-54.23. */
export function job<Input = undefined>(options: JobOptions<Input>): Job<Input> {
    const { every, cron, timeZone, run: work, from = 'end' } = options
    // 54.38 — one schedule, said one way; a type error in TypeScript, and this for JavaScript.
    if ((every === undefined) === (cron === undefined))
        throw new TypeError('A job takes `every` or `cron`, and not both.')
    // 54.36 — the next time `cron` names after `after`; a bad expression throws here, as it is declared.
    const zone = timeZone === undefined ? {} : { tz: timeZone }
    const cronAfter =
        cron === undefined
            ? undefined
            : (after: number): number | undefined =>
                  Bun.cron.parse(cron, after, zone)?.getTime()
    cronAfter?.(Date.now())
    const intervalOf = typeof every === 'function' ? every : () => every ?? 0
    const logger =
        options.name === undefined
            ? log.named('job')
            : log.named('job').named(options.name)
    let current: JobStatus = {
        running: false,
        lastRun: null,
        lastTook: null,
        lastResult: undefined,
        nextRun: null,
        lastError: null,
    }
    // 54.18 — A MEMO THE JOB WRITES, one value for every caller: the server owns no `Reactive` (16.109).
    const status = memo((): JobStatus => current, {
        global: true,
        store: options.store as Store<unknown> | undefined,
    })
    const write = (changed: Partial<JobStatus>): JobStatus => {
        current = { ...current, ...changed }
        status.set(current)
        return current
    }
    // When the last run ended, in ms; `undefined` before one has, and before 54.17 has been asked.
    let lastRunAt: number | undefined
    // What the next run is measured from: the last run's end, its start under 54.25, or a cron job's first look.
    let measuredFrom: number | undefined
    let remembered = false
    let running: Promise<Ran> | undefined
    // 54.23 — aborted by `stop`, beside the app's own stop.
    const stopping = new AbortController()

    // When the next run is due in ms, or `undefined` while none is.
    const nextRunAt = (): number | undefined => {
        if (stopping.signal.aborted) return undefined
        // 54.36 — a cron job never run waits for its first time, measured from its first look.
        if (cronAfter !== undefined)
            return cronAfter(measuredFrom ?? Date.now())
        const interval = intervalOf()
        if (!(interval > 0)) return undefined
        return (measuredFrom ?? Date.now()) + interval
    }
    const nextRunOf = (): string | null => {
        const at = nextRunAt()
        return at === undefined ? null : new Date(at).toISOString()
    }

    const runOnce = async (input: Input | undefined): Promise<Ran> => {
        // 54.22 — the app's signal, not the look's: a run outlives the look that started it (7.22).
        const signal = AbortSignal.any([appStopSignal(), stopping.signal])
        const startedAt = Date.now()
        write({ running: true })
        let lastError = current.lastError
        let lastResult = current.lastResult
        let failure: unknown
        try {
            // 54.35 — its own owner, whichever request asked for it or look started it.
            const answered = await ownedBy(signal, () => work(input))
            // 54.19 — a run answering a refusal failed, as one throwing did.
            if (isFailed(answered)) throw answered
            lastError = null
            // 54.41 — what a run that did not fail answered; a failed one leaves the last good one.
            lastResult = answered
        } catch (error) {
            // 54.20 — a run told to stop has not failed.
            if (!signal.aborted) {
                lastError = messageOf(error)
                logger.error('run failed', error)
                failure = error
            }
        }
        // 54.41 — a run told to stop moves none of what it would have recorded (54.20).
        let lastTook = current.lastTook
        if (!signal.aborted) {
            lastRunAt = Date.now()
            lastTook = lastRunAt - startedAt
            measuredFrom = from === 'start' ? startedAt : lastRunAt
        } else lastResult = current.lastResult
        const status = write({
            running: false,
            lastRun:
                lastRunAt === undefined
                    ? null
                    : new Date(lastRunAt).toISOString(),
            lastTook,
            lastResult,
            nextRun: nextRunOf(),
            lastError,
        })
        return { status, failure }
    }

    // 54.16 — a run asked for while one is in flight joins it, its input unread. Cleared once
    // settled rather than inside the run, which may settle before it is filed as in flight.
    const ran = (input?: Input): Promise<Ran> => {
        if (running !== undefined) return running
        if (stopping.signal.aborted)
            return Promise.resolve({ status: current, failure: undefined })
        const started = runOnce(input)
        running = started
        started.then(() => {
            if (running === started) running = undefined
        })
        return started
    }
    // 54.39 — `Job.run` rejects with what the run threw or refused, as a handler's call does (16.3);
    // the status still records it, and a look's run, which nobody awaits, is logged alone (54.19).
    // A run asked for and not awaited — `void digest.run()` — is not reported twice: its failure is
    // logged and kept, and only whoever awaits it is handed the rejection.
    const run = (input?: Input): Promise<JobStatus> => {
        const settled = ran(input).then(({ status, failure }) =>
            failure === undefined ? status : Promise.reject(failure),
        )
        settled.then(undefined, () => undefined)
        return settled
    }

    const look = async (): Promise<void> => {
        if (stopping.signal.aborted) return
        // 54.34 — read in the look's body, so its turning false is a look of its own.
        if (options.paused?.() === true) return
        if (!remembered) {
            remembered = true
            // 54.17 — WHAT THE STORE KEPT: the last run's end, result and error resume, and a process
            // that is starting runs nothing — a run a crash cut off moved no `lastRun`, so it is due
            // again (54.42).
            if (options.store !== undefined) {
                const kept = await status()
                if (kept !== current) {
                    current = { ...kept, running: false }
                    write({})
                }
                lastRunAt =
                    current.lastRun === null
                        ? undefined
                        : Date.parse(current.lastRun)
            }
            // 54.36 — a cron job's first look is where its first time is counted from.
            measuredFrom =
                lastRunAt ?? (cronAfter === undefined ? undefined : Date.now())
        }
        const dueAt = nextRunAt()
        // 54.15 — an `every` job never run is due at once; a cron job counts from its first look.
        if (
            dueAt !== undefined &&
            (measuredFrom === undefined || Date.now() >= dueAt)
        ) {
            // 54.25 — the clock spaces its looks from when one settles, so a look waiting on the run
            // would measure from its end. A look made while it runs joins it (54.16): a run due
            // while the last one overran starts at the look after that one ends.
            if (from === 'start') void ran()
            else await ran()
            return
        }
        const nextRun = nextRunOf()
        if (current.nextRun !== nextRun) write({ nextRun })
    }

    const stop = async (): Promise<JobStatus> => {
        stopping.abort()
        if (running !== undefined) await running
        return write({ nextRun: null })
    }

    // 54.14 — EACH LOOK IS SPACED FROM THE END OF THE ONE BEFORE, so a look waiting on a run is
    // followed by the whole interval rather than at once. `turn` moves with every halt, so a look
    // settling after one arms nothing.
    const lookEvery =
        cron !== undefined
            ? CRON_LOOK
            : typeof every === 'number' && every > 0
              ? Math.min(every, LONGEST_LOOK)
              : LONGEST_LOOK
    const clock = {
        timer: null as ReturnType<typeof setTimeout> | null,
        running: false,
        turn: 0,
    }
    const lookThenArm = (): void => {
        const turn = clock.turn
        look()
            .catch((error: unknown) => logger.error('look failed', error))
            .then(() => {
                if (clock.turn !== turn) return
                armTimer(clock, lookEvery, () => {
                    clock.timer = null
                    lookThenArm()
                })
            })
    }
    CLOCKS.add({
        start: () => {
            if (clock.running) return
            clock.running = true
            // 54.44 — the first look waits out `delay`; a halt before it clears the timer.
            const delay = options.delay ?? 0
            if (delay > 0)
                armTimer(clock, delay, () => {
                    clock.timer = null
                    lookThenArm()
                })
            else lookThenArm()
        },
        halt: () => {
            clock.running = false
            clock.turn += 1
            if (clock.timer !== null) clearTimeout(clock.timer)
            clock.timer = null
        },
        inFlight: () => running,
    })
    return { status, run, stop }
}
