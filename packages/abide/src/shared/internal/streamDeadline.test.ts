// The streaming idle clock, with its substrate chosen rather than inherited.
//
// While this lived inside `memo.ts` as a module-private function, the BROWSER branch was unreachable
// from `bun test` — happy-dom deletes global `window`, so the process always presents a Node `Timeout`
// with a `refresh()` method. The bug that branch exists for (calling `refresh()` on a browser's numeric
// handle throws, the throw lands in the stream pump's catch, and the whole transcript fails on a
// per-chunk cause) was found by the docs-app e2e suite. These are the unit tests that were impossible.

import { describe, expect, test } from 'bun:test'
import { armStreamDeadline, type StreamTimerHandle, type StreamTimers } from './streamDeadline.ts'

// A NODE-LIKE substrate: an object handle carrying `refresh`/`unref`, counting every call so the
// assertions can be about WORK (how many timers were allocated) rather than about elapsed time.
function nodeTimers(): StreamTimers & {
    sets: number
    clears: number
    refreshes: number
    unrefs: number
    fire(): void
} {
    let pending: (() => void) | null = null
    const counts = { sets: 0, clears: 0, refreshes: 0, unrefs: 0 }
    const handle: StreamTimerHandle = {
        refresh: () => {
            counts.refreshes++
        },
        unref: () => {
            counts.unrefs++
        },
    }
    return {
        ...counts,
        get sets() {
            return counts.sets
        },
        get clears() {
            return counts.clears
        },
        get refreshes() {
            return counts.refreshes
        },
        get unrefs() {
            return counts.unrefs
        },
        set(onIdle) {
            counts.sets++
            pending = onIdle
            return handle
        },
        clear() {
            counts.clears++
        },
        fire() {
            pending?.()
        },
    }
}

// A BROWSER-LIKE substrate: `setTimeout` returns a NUMBER. No `refresh`, no `unref`, and touching
// either would be a TypeError — which is the whole point of the probe.
function browserTimers(): StreamTimers & { sets: number; clears: number; fire(): void } {
    let pending: (() => void) | null = null
    const counts = { sets: 0, clears: 0 }
    let next = 1
    return {
        get sets() {
            return counts.sets
        },
        get clears() {
            return counts.clears
        },
        set(onIdle) {
            counts.sets++
            pending = onIdle
            return next++
        },
        clear() {
            counts.clears++
        },
        fire() {
            pending?.()
        },
    }
}

describe('an unbounded stream arms nothing', () => {
    test.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])('ms=%p arms no timer', (ms) => {
        const timers = nodeTimers()
        const deadline = armStreamDeadline(ms, () => {}, timers)
        deadline.progress()
        deadline.progress()
        deadline.cancel()
        expect(timers.sets).toBe(0)
        expect(timers.clears).toBe(0)
    })
})

describe('the node substrate restarts IN PLACE', () => {
    test('a hot stream allocates exactly one timer however many chunks arrive', () => {
        const timers = nodeTimers()
        const deadline = armStreamDeadline(50, () => {}, timers)
        for (let chunk = 0; chunk < 100; chunk++) deadline.progress()
        // THE WORK, not the outcome: one `setTimeout` for the whole stream, and the per-chunk cost is a
        // `refresh()` on the timer already held.
        expect(timers.sets).toBe(1)
        expect(timers.refreshes).toBe(100)
        expect(timers.clears).toBe(0)
    })

    test('the timer is unref’d, so an idle stream does not hold the process open', () => {
        const timers = nodeTimers()
        armStreamDeadline(50, () => {}, timers)
        expect(timers.unrefs).toBe(1)
    })

    test('cancel clears the one timer', () => {
        const timers = nodeTimers()
        armStreamDeadline(50, () => {}, timers).cancel()
        expect(timers.clears).toBe(1)
    })

    test('the idle callback is what the clock fires', () => {
        const timers = nodeTimers()
        let tripped = 0
        armStreamDeadline(
            50,
            () => {
                tripped++
            },
            timers,
        )
        timers.fire()
        expect(tripped).toBe(1)
    })
})

describe('the browser substrate re-sets, and never touches refresh', () => {
    // THE REGRESSION. A numeric handle has no `refresh`; calling it threw inside the stream pump, which
    // failed the transcript — a whole-stream break with a per-chunk cause.
    test('progress does not throw on a numeric handle', () => {
        const timers = browserTimers()
        const deadline = armStreamDeadline(50, () => {}, timers)
        expect(() => {
            deadline.progress()
        }).not.toThrow()
    })

    test('each chunk clears and re-sets, since there is nothing to restart in place', () => {
        const timers = browserTimers()
        const deadline = armStreamDeadline(50, () => {}, timers)
        deadline.progress()
        deadline.progress()
        expect(timers.sets).toBe(3) // the arm, plus one per chunk
        expect(timers.clears).toBe(2)
    })

    test('the re-set timer is the one that fires, and cancel stops it', () => {
        const timers = browserTimers()
        let tripped = 0
        const deadline = armStreamDeadline(
            50,
            () => {
                tripped++
            },
            timers,
        )
        deadline.progress()
        timers.fire()
        expect(tripped).toBe(1)
        deadline.cancel()
        expect(timers.clears).toBe(2) // one for the progress re-set, one for the cancel
    })
})
