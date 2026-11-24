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

// The length `format.relative` writes a gap under a minute in: `now`, until the gap is one.
const MINUTE = 60_000

/** The time every followed label is written against, in epoch milliseconds. */
const current = /* @__PURE__ */ reactive(0)
// The instants followed, each with how many `time`s stand on it. Read by nothing reactive: the timer
// is the only thing that asks.
const followed = new Map<number, number>()
let timer: ReturnType<typeof setTimeout> | undefined
// When the standing timer fires, in epoch milliseconds, and the instant it was set for.
let due = Number.POSITIVE_INFINITY
let dueFor: number | undefined
let rescheduling = false

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
    due = Number.POSITIVE_INFINITY
    dueFor = undefined
    if (followed.size === 0 || document.visibilityState === 'hidden') return
    const now = Date.now()
    // The soonest found first and armed once: weighed one at a time, a list followed oldest-first
    // re-armed for each newer label, a timer per label per tick.
    let first: number | undefined
    let wait = Number.POSITIVE_INFINITY
    for (const time of followed.keys()) {
        const next = nextChange(time, now)
        if (next < wait) {
            wait = next
            first = time
        }
    }
    arm(first as number, now, wait)
}

/** The timer moved to `time`'s next change, where that comes before the one standing. */
function soonest(time: number, now: number): void {
    const wait = nextChange(time, now)
    if (now + wait < due) arm(time, now, wait)
}

function arm(time: number, now: number, wait: number): void {
    clearTimeout(timer)
    due = now + wait
    dueFor = time
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
    if (followed.size === 0) {
        document.addEventListener('visibilitychange', shown)
        current.set(Date.now())
    }
    followed.set(time, (followed.get(time) ?? 0) + 1)
    // ONE TIME WEIGHED, NOT EVERY ONE: the timer already stands at the soonest change of the rest, so
    // a time arriving moves it only where its own change comes first. Rescanning every time on every
    // follow made a list of n labels n² to mount — 190 ms at 4,000.
    if (document.visibilityState !== 'hidden') soonest(time, Date.now())
    let left = false
    return () => {
        if (left) return
        left = true
        const standing = (followed.get(time) ?? 1) - 1
        if (standing === 0) followed.delete(time)
        else followed.set(time, standing)
        if (followed.size === 0) {
            document.removeEventListener('visibilitychange', shown)
            schedule()
            return
        }
        // Only the time the timer was set for moves it, and once a turn however many leave in it — a
        // list unmounting reschedules once rather than once a row.
        if (standing !== 0 || time !== dueFor || rescheduling) return
        rescheduling = true
        queueMicrotask(() => {
            rescheduling = false
            schedule()
        })
    }
}

/** The time to write a label against: the clock's in a browser, the moment it is read on a server. */
export function clock(): number {
    return inBrowser() ? current() || Date.now() : Date.now()
}
