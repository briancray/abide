/*
True for an `async () => …` / `async function () {}`. This is the async cell's
`await` marker at runtime: the `computed`/`linked` transform lowers `computed(await p)`
to `computed(async () => await p)`, so an async-function seed means "unwrap the
promise and track it" — as opposed to a plain thunk returning a promise, which is held
opaque (`Computed<Promise<T>>`). The tag is the reliable signal (`.constructor.name`
survives minification less reliably; `Symbol.toStringTag` is spec-stable).
*/
export function isAsyncFunction(value: unknown): boolean {
    return (
        typeof value === 'function' &&
        (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] === 'AsyncFunction'
    )
}
