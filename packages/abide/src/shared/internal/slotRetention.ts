// HOW LONG A MEMO SLOT'S VALUE IS GOOD FOR — one predicate, for both fill paths.
//
// A slot's retention is three things: the memo's `ttl`, the `loadedAt` stamp of when the current value
// settled, and the `expired` flag a tripped run deadline sets (ADR 0028 D7 — settled BUT immediately
// expired, so `fn.error()` still reports the TimeoutError while the next read runs cold).
//
// It was asked in TWO places, because the fill paths hold the value somewhere different. `isExpired` reads
// `slot.state`, which is where the loading path keeps it; the auto-tracked path leaves `state` idle and
// keeps the value in a backing computed, so `autoExpire` compared the stamp itself — with a comment saying
// exactly that ("`isExpired` cannot answer for this path"). Two predicates over one stamp, each with its
// own `ttl === Infinity` fast path, and only one of them knowing the stream rule.
//
// What actually differs is not the question but WHAT THE SLOT IS HOLDING, which the caller already knows.
// So that becomes the argument, and there is one predicate.
//
// The clock is injectable for the same reason `streamDeadline`'s timers are: retention is arithmetic, and
// arithmetic tested through `await sleep(...)` is a race that also costs the suite the sleep.
//
// As a defaulted PARAMETER, not a module-level holder a test swaps. Two reasons, and the second is the
// one that matters: a default parameter holding the FUNCTION (`clock = Date.now`) is a reference, not a
// call, so the `Infinity` short-circuit below still returns without reading any clock; and a global a test
// mutates outlives the file that set it, so the next file in the same `bun test` process would silently
// run against a frozen clock — every ttl assertion in it passing while asserting nothing.

// What the slot is holding, from the caller's side of the fill-mode split.
export type RetainedKind =
    // Idle or pending: there is nothing retained, so nothing can be stale.
    | 'nothing'
    // A settled value or error — the ordinary case on both fill paths.
    | 'value'
    // An OPEN stream: retained regardless of `ttl` (replayable-streams §2). Its clock starts at CLOSE, at
    // which point the caller passes `'value'` instead.
    | 'openStream'

// The retention fields of a slot. A structural subset rather than the whole `Slot`, so this module cannot
// reach for the state machine and the tests need no memo.
export interface RetentionFields {
    loadedAt: number
    expired: boolean
}

// Is what this slot holds past its retention window?
//
// `expired` is checked FIRST and beats every retention policy: a deadline expires a slot whatever its
// `ttl`, and `ttl === Infinity` (a read's default) short-circuits before the clock is consulted, so it
// could not be expressed as a stamp.
//
// The `Infinity` check then comes before the clock read, which is the hot path for every memo that names
// no retention: one number compare, no `Date.now()`.
export function isRetentionStale(
    fields: RetentionFields,
    ttl: number,
    retained: RetainedKind,
    clock: () => number = Date.now,
): boolean {
    if (fields.expired) return true
    if (ttl === Infinity) return false
    if (retained === 'nothing' || retained === 'openStream') return false
    return clock() - fields.loadedAt >= ttl
}

// Stamp "settled now". One statement of what the stamp MEANS, so a settle point cannot record a
// different clock than the predicate reads — which is the whole reason the clock is injectable.
//
// THAT ARGUMENT ONLY HOLDS IF EVERY SETTLE POINT USES IT. For a long time one did: `memo.ts` called this
// once and wrote `loadedAt = Date.now()` by hand at eight other settle points, so the module's stated
// contract ("there is one clock") was true of the predicate and false of the stamp, and the
// injectability nothing could reach was bought and never spent. The two verbs below close the rest of
// it — `expired` had no verb at all and was written raw at three of those sites.
export function stampRetained(fields: RetentionFields, clock: () => number = Date.now): void {
    fields.loadedAt = clock()
}

// Stamp "settled now, and this outcome EXPIRES the slot" — a tripped run deadline (ADR 0028 D7), which
// must re-run cold on the next read rather than serve a truncated transcript for the rest of its `ttl`.
// One verb rather than two writes, because the two fields always move together at a settle: stamping the
// clock and forgetting the flag retains a dead value, and the reverse expires a live one.
export function stampExpired(
    fields: RetentionFields,
    expired: boolean,
    clock: () => number = Date.now,
): void {
    fields.loadedAt = clock()
    fields.expired = expired
}

// A NEW RUN supersedes a deadline expiry (ADR 0028 D7): the flag exists to force exactly this run, so
// clearing it as the run starts is what keeps ONE cold retry from becoming a permanent one. Distinct
// from `clearRetention` because it deliberately leaves `loadedAt` alone — the previous value is still
// what is being served while the re-run is in flight, and zeroing its clock here would report a slot
// that has never settled.
export function clearExpiry(fields: RetentionFields): void {
    fields.expired = false
}

// Forget everything retained — the slot holds nothing again. `loadedAt = 0` is not "the epoch", it is
// the idle sentinel, which is why this is a verb and not an assignment.
export function clearRetention(fields: RetentionFields): void {
    fields.loadedAt = 0
    fields.expired = false
}
