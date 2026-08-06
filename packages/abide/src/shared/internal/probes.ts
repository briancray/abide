// The two "what kind of thing is this?" probes both lanes ask of every value they handle.
//
// A leaf on purpose: it imports nothing, so the server's emit path and the reactive graph can both
// have it without the emit path pulling in reactivity. One implementation because the two lanes have
// to AGREE — a server that awaits something the client renders as text is a hydration mismatch.
//
// The typeof guard is not defensive spelling, it is the whole cost. `value?.then` on a PRIMITIVE
// boxes it and walks a wrapper prototype: 31 ns on a number in JSC against 1 ns once the guard
// short-circuits. Every write, every slot value and every "is this settled?" probe runs this, so on
// `state.set` alone it is the difference between 44 ns and 14 ns — a hand-written store's 15 ns.

export function isThenable(value: unknown): value is PromiseLike<unknown> {
    if (value === null) return false
    const type = typeof value
    if (type !== 'object' && type !== 'function') return false
    return typeof (value as { then?: unknown }).then === 'function'
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    if (value === null) return false
    const type = typeof value
    if (type !== 'object' && type !== 'function') return false
    return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
}

// How deep a `cause` chain is followed. A cap rather than a seen-set: a cycle is the only thing an
// unbounded walk has to fear, and eight links is already further than a wrapped error ever nests.
const CAUSE_DEPTH = 8

/**
 * Is `error` the one named `name` — directly, or wrapped as the `cause` of something else?
 *
 * The NAME rather than the class, because the question outlives the constructor: an error that
 * crossed a wire arrives as a plain object, and `instanceof` on it is false however faithfully it
 * was serialised. Backing `fn.isError` on the shared surface.
 */
export function isNamedError(error: unknown, name: string): boolean {
    let at = error
    for (let depth = 0; depth < CAUSE_DEPTH; depth++) {
        if (at === null || typeof at !== 'object') return false
        if ((at as { name?: unknown }).name === name) return true
        at = (at as { cause?: unknown }).cause
    }
    return false
}
