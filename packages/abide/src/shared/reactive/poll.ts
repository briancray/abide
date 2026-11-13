// A REFRESH ON A CLOCK. RULEBOOK 7.20 through 7.28: `poll` is `s.refresh` (7.4) run every `every`
// milliseconds, which is what an app otherwise writes as a `setInterval` in `onStart` and a
// `clearInterval` in `onStop` — and then has to remember for every value, keyed entry and request.
//
// NO FIELD ON THE CELL. The clock's stop is handed to the owner building the value, through
// `ownedPoll`, so a value declaring no `poll` carries nothing for it, and the read and write paths
// never see it. A `Keyed` polls with ONE clock over the entries it holds at each tick, so an entry
// its `ttl` evicted is out of the walk by being out of the map.
//
// A POLL NO OWNER STOPS IS A JOB — a module's value, a `global` one — and the app is its owner:
// `App.listen` makes its first run (7.29, 7.30), after its `delay` (7.34), and `App.stop` stops it
// (7.26, 7.27), aborting `stopSignal` first (7.38). Filed here rather than on the cell, for the same
// reason.

import { LONGEST_DELAY } from '../LONGEST_DELAY.ts'
import type { Cell } from './cellShape.ts'
import type { Reactive } from './Reactive.ts'
import { unrefTimer } from './unrefTimer.ts'
import { owned, owning } from './watch.ts'

/** What `poll` takes: an interval, or one with its spacing and a job's first-run delay. */
export type Poll =
    | number
    | {
          every: number
          after?: 'tick' | 'settle'
          delay?: number | (() => number)
      }

type Polled = Pick<Reactive<unknown>, 'busy' | 'refresh' | 'then'>

/** One poll's clock, and the values it refreshes. */
class Clock {
    readonly every: number
    /** 7.33 — whether each refresh is spaced from the previous run's end rather than from a tick. */
    readonly settle: boolean
    readonly delay: number | (() => number) | undefined
    readonly values: () => Iterable<Polled>
    /** Whether the clock is running — a timer armed, or a settle being waited on (7.33). */
    running = false
    timer: ReturnType<typeof setTimeout> | undefined = undefined
    /** Moved by every stop, so a settle waited on before it arms nothing after it. */
    turn = 0
    /** 7.29 — the value whose first run is still to come, or `null` once it has run. */
    first: Polled | null
    /** 7.40 — a job's record, filed as stopped by `App.stop`; `null` on a clock that is no job. */
    readonly record: Cell | null
    /** 7.34 — the wait before that first run, armed by an opening. */
    delayTimer: ReturnType<typeof setTimeout> | undefined = undefined
    constructor(
        poll: Poll,
        values: () => Iterable<Polled>,
        held: { record: Cell; value: Polled } | null,
    ) {
        const spelled = typeof poll === 'number' ? { every: poll } : poll
        this.every = spelled.every
        this.settle = spelled.after === 'settle'
        this.delay = spelled.delay
        this.values = values
        this.first = held === null ? null : held.value
        this.record = held === null ? null : held.record
    }
}

const UNOWNED = new Set<Clock>()

/** 7.29 — each record whose first run is held back, to its clock. */
const HELD = new WeakMap<Cell, Clock>()

/** 7.40 — the record of every job `App.stop` stopped, until an app opens again. */
const STOPPED_JOBS = new WeakSet<Cell>()

/**
 * The records of every value declaring `poll` — a keyed one's entries included — for 7.28.
 *
 * A SET OFF THE CELL, read only where a failure lands, so no other path pays for it.
 */
const POLLED = new WeakSet<object>()

/** 7.38, 7.39 — what `stopSignal` answers: aborted by a stop, replaced as that stop ends. */
let STOPPING = new AbortController()

/**
 * The signal `App.stop` aborts before it waits on what is in flight — a job's run's way to be told to
 * stop. Never aborted where no app stops, a browser among them.
 */
export function stopSignal(): AbortSignal {
    return STOPPING.signal
}

/** 7.39 — a stop that has ended leaves a signal that does not already say stop. */
export function renewStopSignal(): void {
    if (STOPPING.signal.aborted) STOPPING = new AbortController()
}

/**
 * Throws where `poll` is not a positive number of milliseconds, or names a spacing there is not (7.25).
 *
 * At construction, as 5.14 is: a zero or negative interval is a refresh per turn, and the app
 * still has a stack for it here.
 */
export function refuseBadPoll(label: string, poll: Poll | undefined): void {
    if (poll === undefined) return
    const every = typeof poll === 'number' ? poll : poll.every
    if (!(every > 0))
        throw new Error(
            `${label} declares poll: ${every}. A poll is a positive number of milliseconds.`,
        )
    const after = typeof poll === 'number' ? undefined : poll.after
    if (after !== undefined && after !== 'tick' && after !== 'settle')
        throw new Error(
            `${label} declares poll after: ${String(after)}. A poll runs after a 'tick' or after a 'settle'.`,
        )
}

/** Files `record` as a value declaring `poll`, before its first run can fail. */
export function markPolled(record: object): void {
    POLLED.add(record)
}

/** Whether `record` declares `poll`, for 7.28's warning. */
export function isPolled(record: object): boolean {
    return POLLED.has(record)
}

/**
 * Refreshes `values()` on `poll`'s clock, never holding the process open, stopped with the owner
 * building it — a setup or a request — where there is one, and by `stopUnownedPolls` where there is
 * none.
 *
 * 7.29 — WITH NO OWNER, `held` IS THE VALUE'S RECORD: its first run waits for `App.listen` or the
 * first hit on it, and its clock with it. A `Keyed` passes none, its entries running as they are
 * reached. 7.36 — so `delay` reaches only a clock with a `held`.
 *
 * 7.22 FOLLOWS 6.4's FEATURE TEST (`unrefTimer`). `Infinity` arms nothing; a finite interval past
 * what a timer holds runs at the longest one it does.
 */
export function ownedPoll(
    poll: Poll,
    values: () => Iterable<Polled>,
    held: { record: Cell; value: Polled } | null,
): void {
    const clock = new Clock(poll, values, held)
    if (owning()) {
        clock.first = null
        start(clock)
        owned(() => halt(clock))
        return
    }
    UNOWNED.add(clock)
    if (held === null) start(clock)
    else HELD.set(held.record, clock)
}

/** 7.29 — `record`'s first run has started: its clock starts with it. */
export function firstRunStarted(record: Cell): void {
    const clock = HELD.get(record)
    if (clock === undefined) return
    HELD.delete(record)
    clock.first = null
    clearTimeout(clock.delayTimer)
    clock.delayTimer = undefined
    // 7.41 — a first run made while the app is stopped leaves the clock to the next opening.
    if (!STOPPED_JOBS.has(record)) start(clock)
}

/** 7.40 — whether `record` is a job `App.stop` stopped that no app has opened since. */
export function jobStopped(record: Cell): boolean {
    return STOPPED_JOBS.has(record)
}

/**
 * Starts every poll no owner stops (7.30): a value's first run where it has not had one — after its
 * `delay` (7.34) — and every clock `stopUnownedPolls` stopped.
 */
export function startUnownedPolls(): void {
    for (const clock of UNOWNED) {
        // Ahead of the first run below, which starts the clock only for a job not filed stopped.
        if (clock.record !== null) STOPPED_JOBS.delete(clock.record)
        const first = clock.first
        if (first === null) start(clock)
        else if (clock.delayTimer === undefined) {
            const delay =
                typeof clock.delay === 'function' ? clock.delay() : clock.delay
            // A refresh settles the reload the value owes, which is `firstRunStarted`'s cue.
            if (delay === undefined || !(delay > 0)) first.refresh()
            else {
                clock.delayTimer = setTimeout(
                    () => {
                        clock.delayTimer = undefined
                        clock.first?.refresh()
                    },
                    Math.min(delay, LONGEST_DELAY),
                )
                unrefTimer(clock.delayTimer)
            }
        }
    }
}

/**
 * Aborts `stopSignal` (7.38), stops every poll no owner stops and every `delay` still being waited
 * out (7.26, 7.37), and answers what waits on the run each value has in flight (7.27) — asked once
 * the requests have drained, so one a request started is waited on too.
 *
 * THE VALUES STAY FILED. 42.12 has a second `App` in the process share them, and a run a later
 * read starts is that app's stop to wait on too. A value that has not had its first run is not
 * asked: a probe would start it (3.2, 7.31) — and A JOB IS ASKED BY ITS RECORD rather than by
 * `busy`, for the same reason: a bare `refresh` marks a job stopped here (7.40), and `busy`, a
 * probe, would run the reload the mark owes (7.42).
 */
export function stopUnownedPolls(): () => Promise<void> {
    STOPPING.abort()
    for (const clock of UNOWNED) {
        halt(clock)
        if (clock.record !== null) STOPPED_JOBS.add(clock.record)
        clearTimeout(clock.delayTimer)
        clock.delayTimer = undefined
    }
    return async () => {
        const inFlight: Promise<unknown>[] = []
        for (const clock of UNOWNED) {
            if (clock.first !== null) continue
            const record = clock.record
            for (const value of clock.values())
                if (record === null ? value.busy() : record.loading)
                    inFlight.push(settledEitherWay(value))
        }
        await Promise.all(inFlight)
    }
}

function start(clock: Clock): void {
    if (clock.running || clock.every === Number.POSITIVE_INFINITY) return
    clock.running = true
    if (clock.settle) {
        afterSettle(clock)
        return
    }
    const values = clock.values
    clock.timer = setInterval(
        () => {
            for (const value of values()) refreshIdle(value)
        },
        Math.min(clock.every, LONGEST_DELAY),
    )
    unrefTimer(clock.timer)
}

function halt(clock: Clock): void {
    clock.running = false
    clock.turn += 1
    clearTimeout(clock.timer)
    clock.timer = undefined
}

/**
 * 7.33 — arms the next refresh `every` milliseconds after each value's run in flight settles, so a
 * run longer than the interval is followed by the whole of it rather than at once.
 */
function afterSettle(clock: Clock): void {
    const inFlight: Promise<unknown>[] = []
    for (const value of clock.values())
        if (value.busy()) inFlight.push(settledEitherWay(value))
    if (inFlight.length === 0) {
        armOnce(clock)
        return
    }
    const turn = clock.turn
    Promise.all(inFlight).then(() => {
        if (clock.turn === turn) armOnce(clock)
    })
}

function armOnce(clock: Clock): void {
    clock.timer = setTimeout(
        () => {
            clock.timer = undefined
            for (const value of clock.values()) refreshIdle(value)
            afterSettle(clock)
        },
        Math.min(clock.every, LONGEST_DELAY),
    )
    unrefTimer(clock.timer)
}

// A PROMISE AROUND `then` RATHER THAN `then` ITSELF: what `then` hands back is a value (2.16), and
// awaited it is built — a cell per value per wait, where this leaves it unreached.
function settledEitherWay(value: Polled): Promise<void> {
    return new Promise<void>((done) => {
        value.then(
            () => done(),
            () => done(),
        )
    })
}

/**
 * Refreshes `value` unless it is busy (7.21).
 *
 * A refresh over a load in flight supersedes it, so a producer slower than its interval would
 * otherwise never land.
 */
function refreshIdle(value: Polled): void {
    if (!value.busy()) value.refresh()
}
