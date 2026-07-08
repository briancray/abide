/* True for a Promise-like value — anything carrying a callable `then`. Used to tell an
   async cell's unwrap path (a promise to await) from a synchronously-produced value. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof (value as { then?: unknown }).then === 'function'
    )
}
