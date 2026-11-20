// WORK ON A SCHEDULE: 54.18-54.27. A job is a `global` value on a `poll` nothing reads — the shape
// `poll.ts` already calls a job — so `App.listen` makes its first look and `App.stop` stops it (7.26,
// 7.30). What this adds is the bookkeeping written once: a status a handler can answer, one run at
// a time, and when the last run ended.

import { log } from '#shared/log.ts'
import { type Reactive, reactive, stopSignal } from '#shared/reactive/index.ts'

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
export type Job = {
    status: Reactive<JobStatus>
    runNow: () => Promise<JobStatus>
    stop: () => Promise<JobStatus>
}

/** The longest a job waits between two looks at whether a run is due (54.18). */
const LONGEST_LOOK = 60_000

/** Work run every `every` milliseconds on the server, one run at a time: 54.18-54.27. */
export function job(
    name: string,
    options: {
        /** 54.18, 54.19, 54.25 — the milliseconds between the end of one run and the next, or between their starts under `from`, read at each look where a function. */
        every: number | (() => number)
        /** 54.29 — whether `every` is measured from when the last run `'end'`ed, the default, or from when it `'start'`ed. */
        from?: 'end' | 'start'
        /** 54.26 — the work, handed the signal that says stop. */
        run: (signal: AbortSignal) => unknown
        /** 54.21 — when the last run ended before this process, in epoch milliseconds, or `undefined` where none has. */
        lastRun?: () => number | undefined
    },
): Job {
    const { every, run, from = 'end' } = options
    const intervalOf = typeof every === 'function' ? every : () => every
    const logger = log.named('job').named(name)
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
    // What `every` is measured from: the last run's end, or its start under 54.29.
    let measuredFrom: number | undefined
    let remembered = false
    let running: Promise<JobStatus> | undefined
    // 54.27 — aborted by `stop`, beside the app's own stop.
    const stopping = new AbortController()

    const nextRunOf = (): string | null => {
        const interval = intervalOf()
        if (stopping.signal.aborted || !(interval > 0)) return null
        return new Date((measuredFrom ?? Date.now()) + interval).toISOString()
    }

    const runOnce = async (): Promise<JobStatus> => {
        const signal = AbortSignal.any([stopSignal(), stopping.signal])
        const startedAt = Date.now()
        write({ running: true })
        let lastError = current.lastError
        try {
            await run(signal)
            lastError = null
        } catch (error) {
            // 54.24 — a run told to stop has not failed.
            if (!signal.aborted) {
                lastError =
                    error instanceof Error ? error.message : String(error)
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

    // 54.20 — a run asked for while one is in flight joins it. Cleared once settled rather than
    // inside the run, which may settle before it is filed as in flight.
    const runNow = (): Promise<JobStatus> => {
        if (running !== undefined) return running
        if (stopping.signal.aborted) return Promise.resolve(current)
        const started = runOnce()
        running = started
        started.then(() => {
            if (running === started) running = undefined
        })
        return started
    }

    const look = async (): Promise<void> => {
        if (stopping.signal.aborted) return
        if (!remembered) {
            remembered = true
            lastRunAt = options.lastRun?.()
            measuredFrom = lastRunAt
        }
        const interval = intervalOf()
        if (
            interval > 0 &&
            (measuredFrom === undefined ||
                Date.now() >= measuredFrom + interval)
        ) {
            // 54.29 — the clock spaces its looks from when one settles, so a look waiting on the run
            // would measure from its end. A look made while it runs joins it (54.20): a run due
            // while the last one overran starts at the look after that one ends.
            if (from === 'start') void runNow()
            else await runNow()
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

    reactive(look, {
        global: true,
        poll: {
            every:
                typeof every === 'number' && every > 0
                    ? Math.min(every, LONGEST_LOOK)
                    : LONGEST_LOOK,
            after: 'settle',
        },
    })
    return { status, runNow, stop }
}
