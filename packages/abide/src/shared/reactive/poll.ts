// A REFRESH ON A CLOCK. RULEBOOK 7.20 through 7.25: `poll` is `s.refresh` (7.4) run every `poll`
// milliseconds, which is what an app otherwise writes as a `setInterval` in `onStart` and a
// `clearInterval` in `onStop` — and then has to remember for every value, keyed entry and request.
//
// NO FIELD ON THE CELL. The timer's stop is handed to the owner building the value, through
// `ownedPoll`, so a value declaring no `poll` carries nothing for it, and the read and write paths
// never see it. A `Keyed` polls with ONE timer over the entries it holds at each tick, so an entry
// its `ttl` evicted is out of the walk by being out of the map.

import { LONGEST_DELAY } from '../LONGEST_DELAY.ts'
import { unrefTimer } from './unrefTimer.ts'
import { owned, owning } from './watch.ts'

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

/**
 * Runs `tick` every `poll` milliseconds, never holding the process open, stopped with the owner
 * building it — a setup or a request — where there is one.
 *
 * 7.22 FOLLOWS 6.4's FEATURE TEST (`unrefTimer`). `Infinity` arms nothing; a finite interval past what a timer holds runs
 * at the longest one it does.
 */
export function ownedPoll(poll: number, tick: () => void): void {
    if (poll === Number.POSITIVE_INFINITY) return
    const timer = setInterval(tick, Math.min(poll, LONGEST_DELAY))
    unrefTimer(timer)
    if (owning()) owned(() => clearInterval(timer))
}

/**
 * Refreshes `value` unless it is busy (7.21).
 *
 * A refresh over a load in flight supersedes it, so a producer slower than its interval would
 * otherwise never land.
 */
export function refreshIdle(value: { busy(): boolean; refresh(): void }): void {
    if (!value.busy()) value.refresh()
}
