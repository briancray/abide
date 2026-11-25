// WORK ON A SCHEDULE: 54.18-54.27. A job is a `global` value on a `poll` nothing reads — the shape
// `poll.ts` already calls a job — so `App.listen` makes its first look and `App.stop` stops it (7.26,
// 7.30). What this adds is the bookkeeping written once: a status a handler can answer, one run at
// a time, and when the last run ended.

import { log } from '#shared/log.ts'
import { messageOf } from '#shared/messageOf.ts'
import { memo, type Reactive, reactive } from '#shared/reactive/index.ts'
import { appStopSignal } from '#shared/reactive/poll.ts'

import { ownedBy } from './requestScope.ts'

/** 54.22 — where a job stands, as a page reads it through a handler. */
export type JobStatus = {
    /** Whether a run is going. */
    running: boolean
    /** When the last run ended, as an ISO time, or `null` before one has. */
    lastRun: string | null
    /** When the next run is due, as an ISO time, or `null` while none is. */
    nextRun: string | null
    /** The last run's failure, or `null` where it ended without throwing. */
    lastError: string | null
}

/** 54.18 — a job's status beside the ways to run it ahead of its schedule and to end it. */
export type Job<Input = undefined> = {
    status: Reactive<JobStatus>
    run: (input?: Input) => Promise<JobStatus>
    stop: () => Promise<JobStatus>
}

/** 54.18 — what a job is: its name, its schedule, its work, and what holds or remembers it. */
export type JobOptions<Input = undefined> = {
    /** 54.23 — what a failed run is logged under, beside `job`. */
    name?: string | undefined
    /** 54.26, 54.39 — the work, handed what `Job.run` was given and `undefined` where a look started it; `abortSignal()` in it says stop. */
    run: (input: Input | undefined) => unknown
    /** 54.21 — when the last run ended before this process, in epoch milliseconds, or `undefined` where none has. */
    lastRun?: (() => number | undefined) | undefined
    /** 54.38 — what holds the schedule: while it reads true, a look starts no run. */
    paused?:
        Reactive<boolean, never, never, boolean> | (() => boolean) | undefined
} & (
    | {
          /** 54.18, 54.19, 54.25 — the milliseconds between the end of one run and the next, or between their starts under `from`, read at each look where a function. */
          every: number | (() => number)
          /** 54.29 — whether `every` is measured from when the last run `'end'`ed, the default, or from when it `'start'`ed. */
          from?: 'end' | 'start' | undefined
          cron?: never | undefined
          timeZone?: never | undefined
      }
    | {
          /** 54.40, 54.41 — the times a run is due, as a five-field cron expression or a nickname such as `@daily`. */
          cron: string
          /** 54.41 — the IANA zone `cron` is read in, where it is not the server's own. */
          timeZone?: string | undefined
          every?: never | undefined
          from?: never | undefined
      }
)

/** The longest a job waits between two looks at whether a run is due (54.18). */
const LONGEST_LOOK = 60_000

/** 54.40 — how often a `cron` job looks, so a run starts within a second of the time it is due. */
const CRON_LOOK = 1_000

/** Work run every `every` milliseconds on the server, one run at a time: 54.18-54.27. */
export function job<Input = undefined>(options: JobOptions<Input>): Job<Input> {
    const { every, cron, timeZone, run: work, from = 'end' } = options
    // 54.42 — one schedule, said one way; a type error in TypeScript, and this for JavaScript.
    if ((every === undefined) === (cron === undefined))
        throw new TypeError('A job takes `every` or `cron`, and not both.')
    // 54.40 — the next time `cron` names after `after`; a bad expression throws here, as it is declared.
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
        nextRun: null,
        lastError: null,
    }
    const status = reactive<JobStatus>(current, { global: true })
    const write = (changed: Partial<JobStatus>): JobStatus => {
        current = { ...current, ...changed }
        status.set(current)
        return current
    }
    // When the last run ended, in ms; `undefined` before one has, and before 54.21 has been asked.
    let lastRunAt: number | undefined
    // What the next run is measured from: the last run's end, its start under 54.29, or a cron job's first look.
    let measuredFrom: number | undefined
    let remembered = false
    let running: Promise<JobStatus> | undefined
    // 54.27 — aborted by `stop`, beside the app's own stop.
    const stopping = new AbortController()

    // When the next run is due in ms, or `undefined` while none is.
    const nextRunAt = (): number | undefined => {
        if (stopping.signal.aborted) return undefined
        // 54.40 — a cron job never run waits for its first time, measured from its first look.
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

    const runOnce = async (input: Input | undefined): Promise<JobStatus> => {
        // 54.26 — the app's signal, not the look's: a run outlives the look that started it (7.45).
        const signal = AbortSignal.any([appStopSignal(), stopping.signal])
        const startedAt = Date.now()
        write({ running: true })
        let lastError = current.lastError
        try {
            // 54.39 — its own owner, whichever request asked for it or look started it.
            await ownedBy(signal, () => work(input))
            lastError = null
        } catch (error) {
            // 54.24 — a run told to stop has not failed.
            if (!signal.aborted) {
                lastError = messageOf(error)
                logger.error('run failed', error)
            }
        }
        if (!signal.aborted) {
            lastRunAt = Date.now()
            measuredFrom = from === 'start' ? startedAt : lastRunAt
        }
        return write({
            running: false,
            lastRun:
                lastRunAt === undefined
                    ? null
                    : new Date(lastRunAt).toISOString(),
            nextRun: nextRunOf(),
            lastError,
        })
    }

    // 54.20 — a run asked for while one is in flight joins it, its input unread. Cleared once
    // settled rather than inside the run, which may settle before it is filed as in flight.
    const run = (input?: Input): Promise<JobStatus> => {
        if (running !== undefined) return running
        if (stopping.signal.aborted) return Promise.resolve(current)
        const started = runOnce(input)
        running = started
        started.then(() => {
            if (running === started) running = undefined
        })
        return started
    }

    const look = async (): Promise<void> => {
        if (stopping.signal.aborted) return
        // 54.38 — read in the look's body, so its turning false is a look of its own.
        if (options.paused?.() === true) return
        if (!remembered) {
            remembered = true
            lastRunAt = options.lastRun?.()
            // 54.40 — a cron job's first look is where its first time is counted from.
            measuredFrom =
                lastRunAt ?? (cronAfter === undefined ? undefined : Date.now())
        }
        const dueAt = nextRunAt()
        // 54.19 — an `every` job never run is due at once; a cron job counts from its first look.
        if (
            dueAt !== undefined &&
            (measuredFrom === undefined || Date.now() >= dueAt)
        ) {
            // 54.29 — the clock spaces its looks from when one settles, so a look waiting on the run
            // would measure from its end. A look made while it runs joins it (54.20): a run due
            // while the last one overran starts at the look after that one ends.
            if (from === 'start') void run()
            else await run()
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

    memo(look, {
        global: true,
        poll: {
            every:
                cron !== undefined
                    ? CRON_LOOK
                    : typeof every === 'number' && every > 0
                      ? Math.min(every, LONGEST_LOOK)
                      : LONGEST_LOOK,
            after: 'settle',
        },
    })
    return { status, run, stop }
}
