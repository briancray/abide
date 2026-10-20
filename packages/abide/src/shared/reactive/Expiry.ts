// THE LIFE OF A PRODUCTION. RULEBOOK 6.1 through 6.9: `ttl` says how long what a producer
// made stays good for, and most of the group is about work that must NOT happen — no wake
// (6.1) and nothing started at the deadline (6.9).
//
// A DEADLINE DROPS, IT DOES NOT RELOAD, and that one sentence is the shape of the whole
// mechanism. 6.7 releases the production, 6.8 and 6.9 leave the value neither ready nor
// busy, and 6.6 has the producer run on the READ that follows. Waking at the deadline
// would cause that read, and a `ttl` would then reload every value on its deadline whether
// or not anything wanted it — which is `s.refresh` (7.4) under another name, and is the
// thing this is not.
//
// THE CLOCK IS THE COST, NOT THE COMPARISON, and it is what decides where this is
// called from. `Date.now()` is several times a read of an already-served value, so an
// expiry test on the read path would be the read for every value in the design whether
// or not it declared a `ttl`. `direct` is what keeps it off them: a cell carrying an
// expiry is never direct, so the check lives one frame in on `readIndirect` and a value
// declaring no `ttl` never reaches a clock at all. That is CLAUDE.md's "the expensive
// general path is the fallback, not the default", and here the fallback is the whole
// mechanism.
//
// WHAT IT COSTS EVERY VALUE THAT DECLARES NO `ttl`, measured against the same tree with
// the mechanism cut out, two runs of each: READ A SETTLED VALUE IS UNCHANGED at 4.8 ns and
// 4.9 ns on both trees — the number `setDirect` exists to protect, and the only one on a
// path a template walks per slot per row. Nothing moved beyond the noise in the slow
// direction: every write, fan-out, fan-in, chain and probe case sits inside 2.5%, and the
// two that moved further moved the other way and swap places between runs.
//
// THE FIELD IS ON THE EXPIRY RECORD, NOT ON THE CELL, and that is why. `dropped` could have
// been a cell field beside `landed` and `servable`, and one more field per cell was
// already worth about 5% on `probe a settled DAG 5 wide x 5 deep` when `expiry` itself was
// added — a walk that reads no expiry code at all and is bound by memory traffic. A record
// only a `ttl` value allocates costs the other values nothing.
//
// WALL CLOCK RATHER THAN MONOTONIC. A `ttl` is a cache lifetime, and 8.2 hands the same
// number to a `Store` that necessarily keeps wall-clock time — two clocks for one option
// is two answers to "is this still good". What that costs is a clock stepped backwards
// keeping a production alive longer than it asked for, which is the benign direction:
// nothing is dropped early, and the read-driven backstop in `Reactive.ts` catches up the
// moment the clock does.

import { LONGEST_DELAY } from '../LONGEST_DELAY.ts'

export type Expiry = {
    /** The life of one production, in milliseconds. */
    ms: number
    /** The standing production's mint time, which 6.5 through 6.8 are read off. */
    at: number
    /**
     * Whether the standing production has already been released (6.7).
     *
     * The value is then waiting for a read to call its producer (6.6) — which is a state no
     * combination of the cell's own fields tells apart from an `invalidate` whose load is in
     * flight, and reading it wrong runs the body again on every read. One boolean on a record only
     * a `ttl` value allocates, rather than a field on every cell in the design.
     */
    dropped: boolean
    /**
     * The value's one timer, `null` until a production arms it and again once no deadline is held.
     *
     * 6.3: ONE TIMER PER VALUE.
     */
    timer: ReturnType<typeof setTimeout> | null
}

/**
 * The expiry record for a value declaring `ttl`, or `null` where none is declared or no producer.
 *
 * 6.2: INERT ON A VALUE WITH NO PRODUCER, decided once at construction rather than tested per
 * production. A plain state's contents are what the app put there and nothing here may drop them
 * — so on that value the option does not merely do nothing, it allocates no record, arms no timer
 * and leaves `direct` alone, which is the difference between an inert option and one that costs
 * the read path.
 */
export function expiryFor(
    ttl: number | undefined,
    hasProducer: boolean,
): Expiry | null {
    if (ttl === undefined || !hasProducer) return null
    return { ms: ttl, at: 0, dropped: false, timer: null }
}

/**
 * Arms `fire` after `delay` on the holder's one timer, never holding the process open.
 *
 * 6.3: ONE TIMER, AND THIS IS ONLY ITS PLUMBING — which deadline is nearest is a question about
 * the cell (its body, whether 6.7 has already run) and is answered in `Reactive.ts`
 * where those live. What is here is the part every arming shares. Widened to anything holding one
 * timer, because a keyed `ttl` (11.48) arms the same kind: one per holder.
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
    if (delay === Number.POSITIVE_INFINITY) return
    const timer = setTimeout(
        fire,
        delay > 0 ? Math.min(delay, LONGEST_DELAY) : 0,
    )
    const unref = (timer as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(timer)
    expiry.timer = timer
}
