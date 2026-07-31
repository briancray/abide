// Is this value awaitable? The one copy — the client runtime, the server runtime and `memo` all read
// the same predicate, and the SSR emit leans on it to skip an `await` (and the microtask tick that
// comes with it) for the overwhelmingly common case of a plain, already-settled interpolation value.
//
// A FUNCTION with a `.then` counts. That is not pedantry: this predicate GUARDS an `await`, so it has
// to answer the same question `await` does, and `await` follows `.then` on a callable exactly as on an
// object. `memo` used to carry its own copy that got this right while the copy on the emit hot path did
// not, and the difference was silent — `{v}` over a callable thenable rendered the literal text
// `function() {}` where a bare `await` resolved it. One predicate, so the two can no longer disagree.
// The `typeof` test is a PERFORMANCE guard as well as a correctness one, which is why this is two
// statements rather than the shorter `value != null && typeof (value as any).then === 'function'`.
// Reaching for `.then` on a NUMBER boxes it, and that path costs ~17ns against ~0.29ns for the guarded
// form — 60x, measured. The predicate is emitted into EVERY text slot
// (`renderValue(isThenable($v) ? await $v : $v)`) and a number is among the commonest shapes an
// interpolation produces, so collapsing this to a bare property access is a real regression that no
// correctness test can see.
export function isThenable(value: unknown): value is Promise<unknown> {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
    return typeof (value as Promise<unknown>).then === 'function'
}
