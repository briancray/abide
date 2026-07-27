// Is this value awaitable? The one copy — the client runtime, the server runtime and `memo` all read
// the same predicate, and the SSR emit leans on it to skip an `await` (and the microtask tick that
// comes with it) for the overwhelmingly common case of a plain, already-settled interpolation value.
export function isThenable(value: unknown): value is Promise<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Promise<unknown>).then === 'function'
    )
}
