// 5.3'S ARITY DISCRIMINATION OVER 5.4'S STRUCTURAL DEFAULT, normalised ONCE at
// construction so the write path calls a two-argument comparator and never asks how
// many parameters the author declared.
//
// The node cannot call the author's function raw: a one-parameter `v => v.id` invoked
// as `identity(incoming, previous)` hands back the id, which is truthy, and every
// write after the first is swallowed as a duplicate with the right value still on
// screen — 5.2 failing silently, which is the one way it can fail.
//
// THIS IS A HOT PATH AND IT IS WALKED PER WRITE, over the whole value. 5.2 gates
// every production on it, so a write of a 20,000-row array compares 20,000 rows
// before deciding whether to wake anybody. Two things follow, and both are measured
// rather than assumed:
//
//   - A SCALAR LEAF IS ANSWERED WITHOUT A CALL. The cost is the recursive call, not
//     the comparison: taking `Object.keys` out of the object arm (a for-in pass and a
//     count instead) measured 0.97-1.08x, level, and JSC does not charge for the two
//     arrays. Answering a primitive in the loop that found it is 1.6-1.7x — 33.4 ns
//     per three-field row to 20.0 at n = 10,000.
//   - THE WALK IS BOUNDED. 5.22, and 5.6 is what licenses the answer it gives past
//     the bound: a walk that declines to decide says "not equal", which is the safe
//     direction — a reader that wakes when it need not, rather than a write swallowed
//     with the new value never shown.
//
// THE BUDGET IS THREADED THROUGH THE RETURN, and that is the third measurement. A
// module-level `let` costs more per visit than the walk it bounds (the bounded arm
// came back at 35 µs where the unbounded walk of the same value was 26), and a record
// allocated per call was slower than no bound at all at n = 500. A parameter in and a
// number out keeps the counter a local in every frame, allocates nothing, and touches
// no binding outside the function.

// 5.6 — "not equal" wherever it cannot decide, and a cycle is the case where it
// cannot. A `seen` set would be an allocation per write on the path 5.2 gates; a
// depth counter is a number.
const DEPTH_LIMIT = 32

// 5.22's bound, counted in ELEMENTS AND FIELDS VISITED rather than in nodes: the
// visits are where the cost scales, and an array of 100,000 scalars is one node.
//
// 8,192 is two thousand three-field rows compared exactly — every row of every list
// a page holds in one state, plus its own array — and about 80 µs of walking at the
// rate above. Past it the gate declines and the reader wakes, which is what `identity`
// (a projection, measured at 22 ns against 18,477 for the same write) and `s.patch`
// (14 ns, and 5.21 keeps it off this path entirely) are the answers to. A larger value
// with a cheap reader is the case this protects: the walk is a good trade against a
// re-render and a bad one against `{rows.length}`, and only the bound tells the two
// apart without asking the author.
const VISIT_BUDGET = 8_192

// What is left of the budget, or this: a walk that has answered "not equal".
const NOT_EQUAL = -1

function equal(
    next: unknown,
    previous: unknown,
    depth: number,
    left: number,
): number {
    if (Object.is(next, previous)) return left
    if (depth >= DEPTH_LIMIT) return NOT_EQUAL
    if (next === null || previous === null) return NOT_EQUAL
    if (typeof next !== 'object' || typeof previous !== 'object') return NOT_EQUAL
    if (Array.isArray(next)) {
        if (!Array.isArray(previous) || next.length !== previous.length)
            return NOT_EQUAL
        for (let at = 0; at < next.length; at += 1) {
            left -= 1
            if (left < 0) return NOT_EQUAL
            const held = next[at]
            const before = previous[at]
            // THE LEAF, ANSWERED IN PLACE. `===` and `Object.is` part company on ±0
            // and on `NaN`, and this walk answers through `Object.is` — so an equal
            // pair is re-tested only where it is a zero, and an unequal one only
            // where neither side is an object.
            if (held === before) {
                if (held === 0 && !Object.is(held, before)) return NOT_EQUAL
                continue
            }
            if (
                held === null ||
                before === null ||
                typeof held !== 'object' ||
                typeof before !== 'object'
            ) {
                if (!Object.is(held, before)) return NOT_EQUAL
                continue
            }
            left = equal(held, before, depth + 1, left)
            if (left < 0) return NOT_EQUAL
        }
        return left
    }
    if (Array.isArray(previous)) return NOT_EQUAL
    if (next instanceof Date)
        return previous instanceof Date &&
            next.getTime() === (previous as Date).getTime()
            ? left
            : NOT_EQUAL
    // A `Map`, a `Set`, a class instance, a `Proxy` — a by-value answer for any of
    // them is a guess about what the author meant by equality, so the reference test
    // above is the only one taken.
    const prototype = Object.getPrototypeOf(next)
    if (prototype !== Object.prototype && prototype !== null) return NOT_EQUAL
    if (Object.getPrototypeOf(previous) !== prototype) return NOT_EQUAL
    const keys = Object.keys(next as object)
    if (keys.length !== Object.keys(previous as object).length) return NOT_EQUAL
    const held = next as Record<string, unknown>
    const before = previous as Record<string, unknown>
    for (let at = 0; at < keys.length; at += 1) {
        left -= 1
        if (left < 0) return NOT_EQUAL
        const key = keys[at] as string
        if (!Object.hasOwn(before, key)) return NOT_EQUAL
        const mine = held[key]
        const theirs = before[key]
        // The same leaf, and the same reason it is written twice rather than lifted:
        // the call is the cost being avoided, so a helper here would be the thing
        // this replaced.
        if (mine === theirs) {
            if (mine === 0 && !Object.is(mine, theirs)) return NOT_EQUAL
            continue
        }
        if (
            mine === null ||
            theirs === null ||
            typeof mine !== 'object' ||
            typeof theirs !== 'object'
        ) {
            if (!Object.is(mine, theirs)) return NOT_EQUAL
            continue
        }
        left = equal(mine, theirs, depth + 1, left)
        if (left < 0) return NOT_EQUAL
    }
    return left
}

// A REGISTRY name an app writes, not only the default this module installs.
export function structural(next: unknown, previous: unknown): boolean {
    return equal(next, previous, 0, VISIT_BUDGET) >= 0
}

export function comparator(
    identity: unknown,
): (next: unknown, previous: unknown) => boolean {
    if (identity === undefined) return structural
    const declared = identity as (...args: unknown[]) => unknown
    if (declared.length >= 2)
        return declared as (next: unknown, previous: unknown) => boolean
    return (next, previous) => declared(next) === declared(previous)
}
