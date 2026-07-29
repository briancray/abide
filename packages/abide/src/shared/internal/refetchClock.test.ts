// The throttle/debounce decision, stated once and asserted directly.
//
// This rule used to live twice inside `memo`, reachable only through a real slot, a real load and a
// real timer — so the two spellings could differ (and did: one guarded against a remainder its own
// caller had already excluded) without any test being able to compare them. `now` and `lastRunAt` are
// parameters here, so the window's edges are arithmetic instead of a `setTimeout` race.

import { describe, expect, test } from 'bun:test'
import { refetchClockDecision } from './refetchClock.ts'

const THROTTLE = false
const DEBOUNCE = true

describe('throttle', () => {
    test('the first trigger takes the leading edge', () => {
        // `lastRunAt: 0` is "nothing has fired yet". A cold load is not a trigger, so the first real
        // change must not be deferred.
        expect(refetchClockDecision(THROTTLE, 300, 0, false, 1_000)).toEqual({ kind: 'fire' })
    })

    test('a trigger after the window has elapsed takes the leading edge', () => {
        expect(refetchClockDecision(THROTTLE, 300, 1_000, false, 1_300)).toEqual({ kind: 'fire' })
        expect(refetchClockDecision(THROTTLE, 300, 1_000, false, 5_000)).toEqual({ kind: 'fire' })
    })

    test('a trigger INSIDE the window arms the trailing fire for the remainder', () => {
        expect(refetchClockDecision(THROTTLE, 300, 1_000, false, 1_100)).toEqual({
            kind: 'arm',
            ms: 200,
        })
    })

    test('the boundary is inclusive — exactly one window later fires', () => {
        // Off by one here means a trigger at the window edge silently defers by a full window.
        expect(refetchClockDecision(THROTTLE, 300, 1_000, false, 1_299)).toEqual({
            kind: 'arm',
            ms: 1,
        })
        expect(refetchClockDecision(THROTTLE, 300, 1_000, false, 1_300)).toEqual({ kind: 'fire' })
    })

    test('an armed timer coalesces every further trigger into it', () => {
        // The armed timer IS the trailing fire; a further trigger is exactly what it represents, so it
        // must not arm a second one. Arming a second is how a "rate limit" becomes a fan-out.
        expect(refetchClockDecision(THROTTLE, 300, 1_000, true, 1_100)).toEqual({
            kind: 'coalesce',
        })
        // Even past the window: the pending timer will stamp `lastRunAt` when it fires.
        expect(refetchClockDecision(THROTTLE, 300, 1_000, true, 9_999)).toEqual({
            kind: 'coalesce',
        })
    })

    test('the armed remainder is never negative or zero-length', () => {
        // The auto path used to compute this remainder and then guard it with `> 0 ? … : windowMs` —
        // a fallback for a case the `fire` branch above already claims. `arm` is only reachable when
        // `since < windowMs`, so the remainder is always in (0, windowMs].
        for (let since = 0; since < 300; since++) {
            const decision = refetchClockDecision(THROTTLE, 300, 1_000, false, 1_000 + since)
            if (decision.kind !== 'arm') throw new Error(`expected arm at since=${since}`)
            expect(decision.ms).toBeGreaterThan(0)
            expect(decision.ms).toBeLessThanOrEqual(300)
        }
    })
})

describe('debounce', () => {
    test('every trigger restarts the window — debounce is never leading-edge', () => {
        expect(refetchClockDecision(DEBOUNCE, 300, 0, false, 1_000)).toEqual({
            kind: 'restart',
            ms: 300,
        })
    })

    test('an armed timer restarts rather than coalescing — that is the difference from throttle', () => {
        // Throttle answers `coalesce` here (keep the pending fire); debounce answers `restart` (cancel
        // it and wait for quiet again). Collapsing these two is what makes a debounce fire early.
        expect(refetchClockDecision(DEBOUNCE, 300, 1_000, true, 1_100)).toEqual({
            kind: 'restart',
            ms: 300,
        })
        expect(refetchClockDecision(THROTTLE, 300, 1_000, true, 1_100)).toEqual({
            kind: 'coalesce',
        })
    })

    test('elapsed time does not matter — the window is measured from the last TRIGGER', () => {
        expect(refetchClockDecision(DEBOUNCE, 300, 1_000, false, 9_999)).toEqual({
            kind: 'restart',
            ms: 300,
        })
    })
})

describe('the two edges never agree', () => {
    test.each([
        [0, false, 1_000],
        [1_000, false, 1_100],
        [1_000, true, 1_100],
        [1_000, false, 5_000],
    ] as const)(
        'lastRunAt=%d armed=%s now=%d gives different decisions per edge',
        (lastRunAt, armed, now) => {
            const throttled = refetchClockDecision(THROTTLE, 300, lastRunAt, armed, now)
            const debounced = refetchClockDecision(DEBOUNCE, 300, lastRunAt, armed, now)
            expect(debounced).toEqual({ kind: 'restart', ms: 300 })
            expect(throttled.kind).not.toBe('restart')
        },
    )
})
