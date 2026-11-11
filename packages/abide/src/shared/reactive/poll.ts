// A REFRESH ON A CLOCK. RULEBOOK 7.20 through 7.28: `poll` is `s.refresh` (7.4) run every `poll`
// milliseconds, which is what an app otherwise writes as a `setInterval` in `onStart` and a
// `clearInterval` in `onStop` — and then has to remember for every value, keyed entry and request.
//
// NO FIELD ON THE CELL. The timer's stop is handed to the owner building the value, through
// `ownedPoll`, so a value declaring no `poll` carries nothing for it, and the read and write paths
// never see it. A `Keyed` polls with ONE timer over the entries it holds at each tick, so an entry
// its `ttl` evicted is out of the walk by being out of the map.
//
// A POLL NO OWNER STOPS IS A JOB — a module's value, a `global` one — and the app is its owner:
// `App.listen` makes its first run (7.29, 7.30) and `App.stop` stops it (7.26, 7.27). Filed here rather
// than on the cell, for the same reason.

import { namedLogger } from '../log.ts'
import { LONGEST_DELAY } from '../LONGEST_DELAY.ts'
import type { Reactive } from './Reactive.ts'
import { unrefTimer } from './unrefTimer.ts'
import { owned, owning } from './watch.ts'

type Polled = Pick<Reactive<unknown>, 'busy' | 'refresh' | 'then'>

const POLL_LOG = namedLogger('abide:reactive')

/** A poll 7.23 has no owner to stop: its clock, and the values the clock refreshes. */
type Unowned = {
    poll: number
    timer: ReturnType<typeof setInterval> | undefined
    values: () => Iterable<Polled>
    /** 7.29 — the value whose first run is still to come, or `null` once it has run. */
    first: Polled | null
}

const UNOWNED = new Set<Unowned>()

/** 7.29 — each record whose first run is held back, to its poll. */
const HELD = new WeakMap<object, Unowned>()

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
 * 7.29 — WITH NO OWNER, `held` IS THE VALUE'S RECORD: its first run waits for `App.listen` or the
 * first hit on it, and its clock with it. A `Keyed` passes none, its entries running as they are
 * reached.
 *
 * 7.22 FOLLOWS 6.4's FEATURE TEST (`unrefTimer`). `Infinity` arms nothing; a finite interval past
 * what a timer holds runs at the longest one it does.
 */
export function ownedPoll(
    poll: number,
    values: () => Iterable<Polled>,
    held: { record: object; value: Polled } | null,
): void {
    if (owning()) {
        if (poll === Number.POSITIVE_INFINITY) return
        const timer = armed(poll, values)
        owned(() => clearInterval(timer))
        return
    }
    const unowned: Unowned = {
        poll,
        timer: undefined,
        values,
        first: held === null ? null : held.value,
    }
    UNOWNED.add(unowned)
    if (held === null) arm(unowned)
    else HELD.set(held.record, unowned)
}

/** 7.29 — `record`'s first run is starting: its clock starts with it. */
export function firstRunStarted(record: object): void {
    const unowned = HELD.get(record)
    if (unowned === undefined) return
    HELD.delete(record)
    unowned.first = null
    arm(unowned)
}

/**
 * Starts every poll no owner stops (7.30): a value's first run where it has not had one, and every
 * clock `stopUnownedPolls` stopped.
 */
export function startUnownedPolls(): void {
    for (const unowned of UNOWNED) {
        // A refresh settles the reload the value owes, which is `firstRunStarted`'s cue.
        if (unowned.first !== null) unowned.first.refresh()
        else arm(unowned)
    }
}

/**
 * Stops every poll no owner stops (7.26), and answers what waits on the run each value has in flight
 * (7.27) — asked once the requests have drained, so one a request started is waited on too.
 *
 * THE VALUES STAY FILED. 42.12 has a second `App` in the process share them, and a run a later
 * trigger starts — a bare `refresh` (13.10) — is that app's stop to wait on too. A value that has
 * not had its first run is not asked: a probe would start it (3.2, 7.31).
 */
export function stopUnownedPolls(): () => Promise<void> {
    for (const unowned of UNOWNED) {
        clearInterval(unowned.timer)
        unowned.timer = undefined
    }
    return async () => {
        const inFlight: Promise<unknown>[] = []
        for (const unowned of UNOWNED) {
            if (unowned.first !== null) continue
            for (const value of unowned.values())
                if (value.busy()) inFlight.push(value.then(settle, settle))
        }
        await Promise.all(inFlight)
    }
}

function arm(unowned: Unowned): void {
    if (
        unowned.timer !== undefined ||
        unowned.poll === Number.POSITIVE_INFINITY
    )
        return
    unowned.timer = armed(unowned.poll, unowned.values)
}

function armed(
    poll: number,
    values: () => Iterable<Polled>,
): ReturnType<typeof setInterval> {
    const timer = setInterval(
        () => {
            for (const value of values()) refreshIdle(value)
        },
        Math.min(poll, LONGEST_DELAY),
    )
    unrefTimer(timer)
    return timer
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
