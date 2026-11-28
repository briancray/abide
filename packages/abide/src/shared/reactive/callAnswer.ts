// 16.3, 11.12 — A CALL'S ANSWER CARRIES THE VALUE IT ANSWERS FOR: the promise or the stream a `memo`
// or an `Rpc` call hands back keeps the entry it reached for those args, so a derived `reactive`
// handing that answer back whole — or a `set` writing it — adopts the value rather than settling it
// to one snapshot. Carried and read here alone; the member is the type the build reads a
// handler's value and refusals off (19.21), and a leaf of no imports, as `Reactive.ts` reads it.

/** The member a call's answer types the value and refusals it carries on. */
export const CALL_ENTRY: unique symbol = Symbol('abide.callEntry')

/** `answer`, carrying the entry `entry` it answers for. */
export function carryEntry<Answer extends object>(
    answer: Answer,
    entry: unknown,
): Answer {
    ;(answer as { [CALL_ENTRY]?: unknown })[CALL_ENTRY] = entry
    return answer
}

/** The entry a call's answer carries, where `value` is one. */
export function entryOfAnswer(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return undefined
    return (value as { [CALL_ENTRY]?: unknown })[CALL_ENTRY]
}
