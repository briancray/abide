/**
 * Whether `value` is a stream of chunks: an object carrying `Symbol.asyncIterator` — a
 * `ReadableStream` among them, which is async-iterable in bun. A `Reactive` is callable, not an
 * object, so it is never one (1.6).
 */
export function isAsyncIterable(
    value: unknown,
): value is AsyncIterable<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
            'function'
    )
}
