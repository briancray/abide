// ONE TIMER PER HOLDER. A keyed value's `ttl` (11.48) and a debounce or throttle window (5.12, 5.13)
// each arm one timer on the record that holds it, and never one that holds the process open (6.4).

import { LONGEST_DELAY } from '../LONGEST_DELAY.ts'
import { unrefTimer } from './unrefTimer.ts'

/**
 * Arms `fire` after `delay` on the holder's one timer, never holding the process open.
 *
 * ONE TIMER, AND THIS IS ONLY ITS PLUMBING — which deadline is nearest is a question about the
 * holder, answered where it lives. What is here is the part every arming shares, and arming a holder
 * that already stands a timer replaces that timer rather than adding a second: a keyed `ttl` (11.48)
 * and a window (5.12) each hold one.
 *
 * 6.4: A TIMER MUST NOT HOLD THE PROCESS OPEN, and the feature test is the isomorphism rather
 * than an environment branch. Bun hands back a `Timer` carrying `unref`; a browser hands back a
 * number and has no process to hold open, so the clause is satisfied there by there being nothing
 * to satisfy. CLAUDE.md's uniformity bias is exactly this shape — one mechanism, inert on the side
 * that cannot need it.
 *
 * PAST WHAT `setTimeout` HOLDS — 2^31 - 1 ms, near 25 days — a delay is run after 1 ms, and a
 * deadline that fires early finds nothing expired and re-arms: a timer a millisecond for the life of
 * the value. So `Infinity` arms nothing, and a longer finite delay arms at the cap — early, which a
 * deadline re-checks and re-arms from, and which a debounce or throttle window that long takes as
 * its end.
 */
export function armTimer(
    expiry: { timer: ReturnType<typeof setTimeout> | null },
    delay: number,
    fire: () => void,
): void {
    if (expiry.timer !== null) clearTimeout(expiry.timer)
    expiry.timer = null
    if (delay === Number.POSITIVE_INFINITY) return
    const timer = setTimeout(
        fire,
        delay > 0 ? Math.min(delay, LONGEST_DELAY) : 0,
    )
    unrefTimer(timer)
    expiry.timer = timer
}

const OPEN_FOR_GOOD = -1 as unknown as ReturnType<typeof setTimeout>

/**
 * Arms a debounce or throttle window of `ms` on the holder's one timer.
 *
 * 5.12: A WINDOW OF `Infinity` STANDS OPEN FOR GOOD. `armTimer` arms nothing for it, and a throttle
 * reads its window as open while the holder's timer is set — so the timer is set to a handle no
 * `setTimeout` returns, which `clearTimeout` ignores, and the first change is the only one through.
 * A debounce reads no timer, so the same handle leaves it holding forever (5.13).
 */
export function armWindow(
    holder: { timer: ReturnType<typeof setTimeout> | null },
    ms: number,
    fire: () => void,
): void {
    armTimer(holder, ms, fire)
    if (ms === Number.POSITIVE_INFINITY) holder.timer = OPEN_FOR_GOOD
}
