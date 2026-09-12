// THE ONE IMPLEMENTATION OF 1.7'S ORDERING, in `#shared` rather than beside the graph
// because `#server` and `#ui` both read it and three implementations of a two-line
// test is how one of them ends up in the wrong order.
//
// It has no imports of its own — the brand is declared here — so it is a leaf in
// everything but its name. `camelCase` is deliberate: `conventions.test.ts` selects
// the constants-leaf rule on filename casing alone, and this file exports functions.

// The brand a `Reactive` carries. `Symbol.for` rather than a private `Symbol` so a
// value crossing a realm — an iframe, a worker, a second copy of the package in a
// dependency tree — still reads as one. The alternative is a `value.node` duck test,
// which every plain object holding a `node` field would pass.
export const REACTIVE: unique symbol = Symbol.for('abide.reactive') as never

// 1.7. Once 1.5 makes a `Reactive` thenable, the thenable test alone no longer tells
// a load from a value, so wherever the two are distinguished this is asked FIRST.
export function isReactive(value: unknown): boolean {
    return (
        typeof value === 'function' &&
        (value as { [REACTIVE]?: boolean })[REACTIVE] === true
    )
}

// CLAUDE.md's rule about never awaiting a value that is usually already settled: a
// write is a per-interaction path and a settled one must not buy a promise wrap and a
// microtask tick. Guarding is what makes that possible, and the guard reads the brand
// first or every `Reactive` arrives as a load.
export function isThenable(value: unknown): boolean {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as { then?: unknown }).then === 'function'
    )
}

// 15.7 — `Failed` is STRUCTURAL, so this is a shape test rather than an `instanceof`.
// One arriving over a wire was never constructed by this process's `refuse.typed` and
// has no prototype in common with one that was.
export function isFailed(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false
    const failed = value as {
        name?: unknown
        status?: unknown
        message?: unknown
    }
    return (
        typeof failed.name === 'string' &&
        typeof failed.status === 'number' &&
        typeof failed.message === 'string' &&
        'data' in value
    )
}
