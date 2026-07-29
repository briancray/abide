// THE SWR REFETCH CLOCK'S DECISION — `throttle` / `debounce`, as one rule.
//
// A memo has one refetch window and TWO places that implement it, because the two paths gate different
// things: the pulled path gates a CALL (`refresh`, tag-refresh → `startLoad`) and holds nothing, while
// the derivation path gates a PUBLICATION and holds the fill being withheld. `memo.ts` records that as
// a reason not to merge their STATE, and that reasoning stands — one record with half its fields dead
// on each path is worse than two.
//
// But the TIMING rule is not the state. "Debounce restarts the window on every trigger; throttle fires
// on the leading edge, then coalesces everything inside the window into one trailing fire" was written
// out twice — `scheduleRefresh`/`deferFire` and `autoAdmitsNow`/`armAutoAdmit` — and the copies had
// already drifted in the arithmetic: the pulled path armed for `windowMs - since`, reachable only when
// `since < windowMs`, while the auto path computed the same remainder and then guarded it with
// `remaining > 0 ? remaining : windowMs`, a fallback for a case its own caller had already excluded.
// Two spellings of one window, one of them defending against something that cannot happen.
//
// So the DECISION lives here as a pure function of the clock's observable state, and each path keeps
// its own effects — which is the part that genuinely differs.

export type ClockDecision =
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
