// 52.72-52.76 — ONE CLOCK FOR EVERY `time` ON THE PAGE. Each `time` follows the instant it writes,
// and the clock sets one timer for the soonest moment any of their labels next reads differently:
// a label a minute old waits a minute, one a day old waits hours. No timer stands while nothing is
// followed or while the page is hidden; coming back into view reads the time at once.
//
// A server has no clock to tick: a render reads the time it renders at, and so does a page as it
// hydrates, so a label a boundary passed between the two is written as any changed text is.

import { RELATIVE_UNITS } from './format/RELATIVE_UNITS.ts'
import { isServer } from './isServer.ts'
import { reactive } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'
import { register } from './register.ts'

// The length `format.relative` writes a gap under a minute in: `now`, until the gap is one.
const MINUTE = 60_000

/** The time every followed label is written against, in epoch milliseconds. */
const current = /* @__PURE__ */ reactive(0)
// The instants followed, one entry per `time` standing.
const followed = /* @__PURE__ */ reactive<readonly number[]>([])
let timer: ReturnType<typeof setTimeout> | undefined

const inBrowser = (): boolean => typeof window !== 'undefined' && !isServer()

/**
 * The milliseconds from `now` until `format.relative` writes `time` differently: the next half step
 * of the unit it is written in, where the rounded count turns, or the edge where the unit itself
 * turns, whichever comes first.
 */
export function nextChange(time: number, now: number): number {
    const gap = now - time
    // Under a minute either side it reads `now`, until a minute has passed.
    if (Math.abs(gap) < MINUTE) return Math.max(1, MINUTE - gap)
    let size: number = MINUTE
    let larger = Number.POSITIVE_INFINITY
    for (const [, length] of RELATIVE_UNITS) {
        if (Math.abs(gap) >= length) {
            size = length
            break
        }
        larger = length
    }
    // The count turns half a unit past where it stands; `Math.round` rounds a half up.
    let wait = (Math.round(gap / size) + 0.5) * size - gap
    // A past time grows into the next unit; a future one shrinks out of its own.
    if (gap >= 0 && larger !== Number.POSITIVE_INFINITY)
        wait = Math.min(wait, larger - gap)
    if (gap < 0) wait = Math.min(wait, -size - gap + 1)
    return Math.max(1, Math.ceil(wait))
}

function schedule(): void {
    clearTimeout(timer)
    timer = undefined
    const times = followed.peek() ?? []
    if (times.length === 0 || document.visibilityState === 'hidden') return
    const now = Date.now()
    let wait = Number.POSITIVE_INFINITY
    for (const time of times) wait = Math.min(wait, nextChange(time, now))
    timer = setTimeout(tick, wait)
}

function tick(): void {
    current.set(Date.now())
    schedule()
}

// 52.75 — hidden, the page sets no timer; shown again, it reads the time before it schedules.
function shown(): void {
    if (document.visibilityState !== 'hidden') current.set(Date.now())
    schedule()
}

/**
 * Follows `time` until the disposer runs, so the clock ticks when its label next changes. Nothing on
 * a server, which renders a label once.
 */
export function follow(time: number): Disposer {
    if (!inBrowser()) return () => {}
    if ((followed.peek() ?? []).length === 0) {
        document.addEventListener('visibilitychange', shown)
        current.set(Date.now())
    }
    const leave = register(followed, time)
    schedule()
    return () => {
        leave()
        if ((followed.peek() ?? []).length === 0)
            document.removeEventListener('visibilitychange', shown)
        schedule()
    }
}

/** The time to write a label against: the clock's in a browser, the moment it is read on a server. */
export function clock(): number {
    return inBrowser() ? current() || Date.now() : Date.now()
}
