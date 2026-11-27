import { isReactive } from './reactive/isReactive.ts'

/**
 * Whether `value` is a stream of chunks: an object carrying `Symbol.asyncIterator` — a
 * `ReadableStream` among them, which is async-iterable in bun. A `Reactive` iterates its runs (2.5)
 * and is never one: the brand is read first (1.6).
 */
export function isAsyncIterable(
    value: unknown,
): value is AsyncIterable<unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
            'function' &&
        !isReactive(value)
    )
}
