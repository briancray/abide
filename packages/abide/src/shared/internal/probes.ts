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
