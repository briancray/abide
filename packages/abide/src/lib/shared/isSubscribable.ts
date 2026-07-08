import type { NamedAsyncIterable } from './types/NamedAsyncIterable.ts'

/*
A NamedAsyncIterable is an AsyncIterable carrying a `name` — distinguishes a stream argument from
the other probe selector shapes (callables and `{ tags }` objects, neither of
which carries Symbol.asyncIterator).
*/
export function isSubscribable(value: unknown): value is NamedAsyncIterable<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        Symbol.asyncIterator in value &&
        'name' in value
    )
}
