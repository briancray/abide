// A REFRESH ON A CLOCK. RULEBOOK 7.20 through 7.28: `poll` is `s.refresh` (7.4) run every `poll`
// milliseconds, which is what an app otherwise writes as a `setInterval` in `onStart` and a
// `clearInterval` in `onStop` — and then has to remember for every value, keyed entry and request.
//
// NO FIELD ON THE CELL. The timer's stop is handed to the owner building the value, through
// `ownedPoll`, so a value declaring no `poll` carries nothing for it, and the read and write paths
// never see it. A `Keyed` polls with ONE timer over the entries it holds at each tick, so an entry
// its `ttl` evicted is out of the walk by being out of the map.
//
// A POLL NO OWNER STOPS IS A JOB — a module's value, a `global` one — and `App.stop` is its owner
// (7.26, 7.27): filed here rather than on the cell, for the same reason.

import { namedLogger } from '../log.ts'
import { LONGEST_DELAY } from '../LONGEST_DELAY.ts'
import type { Reactive } from './Reactive.ts'
import { unrefTimer } from './unrefTimer.ts'
import { owned, owning } from './watch.ts'

type Polled = Pick<Reactive<unknown>, 'busy' | 'refresh' | 'then'>

const POLL_LOG = namedLogger('abide:reactive')

/** The polls 7.23 has no owner to stop, each with the values its timer refreshes. */
const UNOWNED = new Set<{
    timer: ReturnType<typeof setInterval>
    values: () => Iterable<Polled>
}>()

/**
 * The records of every value declaring `poll` — a keyed one's entries included — for 7.28.
 *
 * A SET OFF THE CELL, read only where a failure lands, so no other path pays for it.
 */
const POLLED = new WeakSet<object>()

/**
 * Throws where `poll` is not a positive number of milliseconds (7.25).
 *
 * At construction, as 5.14 is: a zero or negative interval is a refresh per turn, and the app
 * still has a stack for it here.
 */
export function refuseBadPoll(label: string, poll: number | undefined): void {
    if (poll !== undefined && !(poll > 0))
        throw new Error(
            `${label} declares poll: ${poll}. A poll is a positive number of milliseconds.`,
        )
}

/** Files `record` as a value declaring `poll`, before its first run can fail. */
export function markPolled(record: object): void {
    POLLED.add(record)
}

/** Warns on `abide:reactive` where `record` declares `poll` (7.28). */
export function warnPolledFailure(
    record: object,
    label: string,
    failure: unknown,
): void {
    if (POLLED.has(record))
        POLL_LOG.warning(`${label}: a polled run failed.`, failure)
}

/**
 * Refreshes `values()` every `poll` milliseconds, never holding the process open, stopped with the
 * owner building it — a setup or a request — where there is one, and by `stopUnownedPolls` where
 * there is none.
 *
 * 7.22 FOLLOWS 6.4's FEATURE TEST (`unrefTimer`). `Infinity` arms nothing; a finite interval past what a timer holds runs
 * at the longest one it does.
 */
export function ownedPoll(poll: number, values: () => Iterable<Polled>): void {
    if (poll === Number.POSITIVE_INFINITY) return
    const timer = setInterval(
        () => {
            for (const value of values()) refreshIdle(value)
        },
        Math.min(poll, LONGEST_DELAY),
    )
    unrefTimer(timer)
    if (owning()) owned(() => clearInterval(timer))
    else UNOWNED.add({ timer, values })
}

/**
 * Stops every poll no owner stops (7.26), and answers what waits on the run each value has in flight
 * (7.27) — asked once the requests have drained, so one a request started is waited on too.
 *
 * THE VALUES STAY FILED. 42.12 has a second `App` in the process share them, and a run a later
 * trigger starts — a bare `refresh` (13.10) — is that app's stop to wait on too.
 */
export function stopUnownedPolls(): () => Promise<void> {
    for (const polled of UNOWNED) clearInterval(polled.timer)
    return async () => {
        const inFlight: Promise<unknown>[] = []
        for (const polled of UNOWNED)
            for (const value of polled.values())
                if (value.busy()) inFlight.push(value.then(settle, settle))
        await Promise.all(inFlight)
    }
}

function settle(): void {}

/**
 * Refreshes `value` unless it is busy (7.21).
 *
 * A refresh over a load in flight supersedes it, so a producer slower than its interval would
 * otherwise never land.
 */
function refreshIdle(value: Polled): void {
    if (!value.busy()) value.refresh()
}
