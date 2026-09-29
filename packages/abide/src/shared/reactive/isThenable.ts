/**
 * Whether `value` carries a callable `then` — the guard in front of an `await`.
 *
 * CLAUDE.md, hot paths: never `await` a value that is usually already settled. Every call site
 * guards with this rather than awaiting unconditionally, which costs a promise wrap and a
 * microtask tick per call — and a template slot pays it per row.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as PromiseLike<unknown>).then === 'function'
    )
}
