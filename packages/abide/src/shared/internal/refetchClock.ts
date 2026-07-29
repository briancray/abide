// THE SWR REFETCH CLOCK — `throttle` / `debounce`, as one module.
//
// A memo has one refetch window and used to have TWO implementations of it, because the two paths gate
// different things: the pulled path gates a CALL (`refresh`, tag-refresh → `startLoad`) and holds
// nothing, while the derivation path gates a PUBLICATION and holds the fill being withheld. `memo.ts`
// records that as a reason not to merge their STATE, and that reasoning stands — one record with half
// its fields dead on each path is worse than two.
//
// The STATE is not the window. Three things a caller must know about a window — when it fires, that a
// fire is outstanding, how to cancel it — were half-shared: only the timing DECISION lived here, and
// the stamping, arming, `unref`, cancellation and the outstanding flag were hand-written twice around
// it. Both remaining halves had already drifted:
//
//   • `refreshing()` returned a constant `false` on the derivation path, though `MemoOptions.throttle`
//     documents the window as "`refreshing()` is TRUE and the retained value keeps being served" and
//     `debounce` is declared "identical in every other respect". The justification — an auto fill is
//     synchronous, so it is never revalidating over a stale value — is true of an UNGATED derivation
//     and false of a gated one, which is precisely what serves `admitted` while a newer fill waits.
//   • Cancellation had to be re-plumbed by hand, and `memo.ts` carries the scar: `cancelClock` says
//     "cancelling only the first is why an `invalidate` left a scheduled auto publication armed", and
//     the auto backing grew a `cancelGate` member solely to make the second timer reachable from the
//     first path's cancel.
//
// So the WINDOW lives here, and what genuinely differs between the paths is a parameter: what `fire`
// does, and whether there is anything being served to raise a spinner over.

import { state } from './reactive.ts'

type ClockDecision =
    // The leading edge: act now. The caller stamps `lastRunAt`.
    | { kind: 'fire' }
    // Debounce: clear any armed timer and re-arm for `ms`. Every trigger restarts the window.
    | { kind: 'restart'; ms: number }
    // Throttle's trailing edge: no timer is armed yet, so arm one for `ms`.
    | { kind: 'arm'; ms: number }
    // Throttle, inside the window, with a timer already armed. That timer IS the coalesced trailing
    // fire — this trigger is exactly what it represents, so it adds nothing.
    | { kind: 'coalesce' }

// `windowMs` is assumed > 0: a zero window is not a clock, and both callers short-circuit before here
// (with no clock configured the pulled path is one compare and a tail call).
//
// `lastRunAt` of 0 means nothing has fired yet, so the first real trigger takes throttle's leading
// edge — the same rule both paths already followed for their own "first" case, where a cold load and a
// first publication are both un-gated because there is nothing to serve while they wait.
// EXPORTED as an internal seam, for the tests only: `now` and `lastRunAt` are parameters here, so the
// window's edges are arithmetic instead of a `setTimeout` race. `refetchWindow` below is the interface
// callers use.
export function refetchClockDecision(
    isDebounce: boolean,
    windowMs: number,
    lastRunAt: number,
    timerArmed: boolean,
    now: number,
): ClockDecision {
    // Debounce is never leading-edge by definition.
    if (isDebounce) return { kind: 'restart', ms: windowMs }
    if (timerArmed) return { kind: 'coalesce' }
    const since = now - lastRunAt
    if (since >= windowMs) return { kind: 'fire' }
    return { kind: 'arm', ms: windowMs - since }
}

// ONE SLOT'S REFETCH WINDOW. Per slot, not per memo — `refresh()` across 50 keyed slots gives 50
// independent windows, because they are 50 independent refetches.
export interface RefetchWindow {
    // A trigger arrived: fire now (leading edge), defer, or coalesce into a window already running.
    trigger(): void
    // Is a fire outstanding but not yet started? REACTIVE — this is what `refreshing()` reports during
    // a window, and it is the whole reason the window owns an observable rather than a bare timer.
    deferred(): boolean
    // Drop a scheduled fire. Called where the slot stops being the thing that was scheduled:
    // `invalidate` (the value is now known-wrong, so revalidating it eagerly is worse than the lazy
    // reload the drop already arranges) and slot disposal (the timer would otherwise outlive the slot).
    cancel(): void
}

export interface RefetchWindowOptions {
    isDebounce: boolean
    // Assumed > 0: a zero window is not a clock, and the caller short-circuits before building one.
    ms: number
    // What the window gates. `deferred` is false for the leading edge and true for a trailing fire —
    // the one place the two paths differ once the timing is shared. The pulled path ignores it (a load
    // is a load); the derivation path uses it to keep a state write out of a computation, since its
    // leading edge runs inside the very computed that is about to return the admitted value.
    fire: (deferred: boolean) => void
    // Is there something to raise a spinner OVER? A revalidation with nothing retained has no stale
    // read to mark as refreshing — the same rule `startLoad`'s keepStale branch follows. Absent = yes,
    // which is the derivation path: a gated publication always has an admitted fill being served,
    // because the first one is never gated.
    serving?: () => boolean
}

export function refetchWindow(options: RefetchWindowOptions): RefetchWindow {
    const { isDebounce, ms, fire, serving } = options
    let timer: ReturnType<typeof setTimeout> | undefined
    // The ms epoch of the last fire THIS WINDOW caused, so the throttle window is measured from a load a
    // TRIGGER started rather than from any load at all: a cold read is not a trigger, so a `refresh()`
    // landing 10ms after the initial load still takes the leading edge. 0 = nothing has fired yet.
    let lastRunAt = 0
    // An equal set is a no-op in the cell, so re-triggering inside a debounce window wakes nobody.
    const outstanding = state(false)

    const arm = (delay: number): void => {
        if (serving === undefined || serving()) outstanding.set(true)
        timer = setTimeout(() => {
            timer = undefined
            lastRunAt = Date.now()
            outstanding.set(false)
            fire(true)
        }, delay)
        // A deferred revalidation must not by itself hold the process open — the same reasoning as the
        // stream watchdog, and the same isomorphic guard (browser `setTimeout` returns a number).
        timer.unref?.()
    }

    return {
        trigger(): void {
            const now = Date.now()
            const decision = refetchClockDecision(
                isDebounce,
                ms,
                lastRunAt,
                timer !== undefined,
                now,
            )
            if (decision.kind === 'coalesce') return
            if (decision.kind === 'fire') {
                lastRunAt = now
                outstanding.set(false)
                fire(false)
                return
            }
            if (decision.kind === 'restart' && timer !== undefined) clearTimeout(timer)
            arm(decision.ms)
        },
        deferred: () => outstanding(),
        cancel(): void {
            if (timer !== undefined) {
                clearTimeout(timer)
                timer = undefined
            }
            outstanding.set(false)
        },
    }
}
