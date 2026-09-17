// THE LIFE OF A PRODUCTION. RULEBOOK 6.4 through 6.15: `ttl` says how long what a producer
// made stays good for, and most of the group is about work that must NOT happen — no wake
// (6.4), no timer per retained production (6.6), no turn handed to a live cursor (6.7),
// and nothing started at the deadline (6.15).
//
// A DEADLINE DROPS, IT DOES NOT RELOAD, and that one sentence is the shape of the whole
// mechanism. 6.13 releases the production, 6.14 and 6.15 leave the value neither ready nor
// busy, and 6.12 has the producer run on the READ that follows. Waking at the deadline
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
// been a cell field beside `stale` and `servable`, and one more field per cell was
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

export type Expiry = {
    // The life of one production, in milliseconds.
    ms: number
    // WHEN EACH RETAINED PRODUCTION WAS MINTED, indexed the way the ring is: `minted[i]`
    // pairs with `ring[i]`, so the head's deadline is one load rather than a walk.
    //
    // A PARALLEL ARRAY OF NUMBERS rather than a stamp wrapped around each production.
    // CLAUDE.md's shape rule keeps the ring to one element type, and a cursor is handed
    // what the app published rather than a box this file would have to unwrap on the way
    // out (2.5). Empty on a value that declares no `history`, which is what makes the sweep
    // below free for it.
    minted: number[]
    // The standing production's mint time, which is the whole of the record where no ring
    // is declared — 6.11 through 6.14 are read off this one field.
    at: number
    // 6.13 ALREADY HAPPENED. The standing production has been released and the value is
    // waiting for a read to call its producer (6.12) — which is a state no combination of
    // the cell's own fields tells apart from an `invalidate` whose load is in flight, and
    // reading it wrong runs the body again on every read. One boolean on a record only a
    // `ttl` value allocates, rather than a field on every cell in the design.
    dropped: boolean
    // 6.9: ONE TIMER PER VALUE, `null` until a production arms it and again once the value
    // holds no deadline. Never one per production, which is 6.6.
    timer: ReturnType<typeof setTimeout> | null
}

// What an expiry reads and trims. The narrow face `History.ts` takes for the same reason:
// what this needs is three fields, and naming them is what keeps the cell's internals
// out of a second file.
export type Ringed = {
    ring: unknown[]
    ringBase: number
    ringDepth: number
}

// 6.8: INERT ON A VALUE WITH NO PRODUCER, decided once at construction rather than tested
// per production. A plain state's contents are what the app put there and nothing here
// may drop them — so on that value the option does not merely do nothing, it allocates no
// record, arms no timer and leaves `direct` alone, which is the difference between an
// inert option and one that costs the read path.
//
// A VALUE HOLDING A RING IS NOT THAT VALUE. The rulebook makes a trigger inert on a value
// with no producer (7.6) and inert on a channel (7.10) in two clauses rather than one, and
// a rule is stated exactly once — so what is published into a ring is a production rather
// than a write. That is the reading the whole group depends on: 6.9 is written over a ring.
export function expiryFor(
    ttl: number | undefined,
    hasProducer: boolean,
): Expiry | null {
    if (ttl === undefined || !hasProducer) return null
    return { ms: ttl, minted: [], at: 0, dropped: false, timer: null }
}

// 6.5, AND THE SAME CALL FROM BOTH SIDES: the timer below and the read that follows an
// expiry reach this, so there is one statement of what dropping means rather than two
// that drift.
//
// 6.4 IS WHAT IS NOT HERE — no `cascade`, no `probesMoved`, no `notify`. An expiry
// removes something no reader is looking at: a read answers the LATEST production and
// 2.5 puts everything before it behind `s.history`, so nothing a reader can see has moved.
//
// 6.7 FALLS OUT OF THAT SILENCE plus the cursor's ordinal. A caught-up cursor is parked
// on an unresolved `next()` and only a `notify` settles one, so it is handed no turn; a
// replaying cursor holds an ordinal and clamps `at < ringBase` to `ringBase` the way 9.10
// already has it. Neither is told the window shrank, which is the whole of the clause.
// `keep` is how many of the newest productions no deadline reaches: 1 on a value with no producer,
// whose standing production is what the app put there (6.8), and 0 on every other.
export function dropExpired(
    expiry: Expiry,
    ringed: Ringed,
    keep: number,
): void {
    const minted = expiry.minted
    const droppable = minted.length - keep
    if (droppable <= 0) return
    const deadline = Date.now() - expiry.ms
    // The ring is in mint order, so the expired productions are a PREFIX — the walk stops
    // at the first live one rather than testing the window.
    let dropped = 0
    while (dropped < droppable && (minted[dropped] as number) <= deadline)
        dropped += 1
    if (dropped === 0) return
    // ONE BULK MOVE, the way the `history` trim is. 6.2 is written about a write and the
    // reason carries: `shift()` in the loop moves every remaining element once per
    // expired production, which is the cost that turns a deep ring quadratic.
    minted.splice(0, dropped)
    ringed.ring.splice(0, dropped)
    ringed.ringBase += dropped
}

// 6.9: ONE TIMER, AND THIS IS ONLY ITS PLUMBING — which deadline is nearest is a question
// about the cell (its ring, its body, whether 6.13 has already run) and is answered in
// `Reactive.ts` where those live. What is here is the part every arming shares.
//
// 6.10: A TIMER MUST NOT HOLD THE PROCESS OPEN, and the feature test is the isomorphism
// rather than an environment branch. Bun hands back a `Timer` carrying `unref`; a browser
// hands back a number and has no process to hold open, so the clause is satisfied there by
// there being nothing to satisfy. CLAUDE.md's uniformity bias is exactly this shape — one
// mechanism, inert on the side that cannot need it.
// Widened to anything holding one timer, because a keyed `ttl` (11.49) arms the same kind:
// one per holder, never holding the process open (6.10).
export function armTimer(
    expiry: { timer: ReturnType<typeof setTimeout> | null },
    delay: number,
    fire: () => void,
): void {
    const timer = setTimeout(fire, delay > 0 ? delay : 0)
    const unref = (timer as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(timer)
    expiry.timer = timer
}

// The head's deadline, or `Infinity` where the ring holds nothing. 6.9 arms at the nearest
// deadline a value holds and this is one of the two candidates.
export function headDeadline(expiry: Expiry, keep: number): number {
    const head = expiry.minted[0]
    if (head === undefined || expiry.minted.length <= keep)
        return Number.POSITIVE_INFINITY
    return head + expiry.ms
}
