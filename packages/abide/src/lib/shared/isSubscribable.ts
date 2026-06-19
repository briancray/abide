import type { Subscribable } from './types/Subscribable.ts'

/*
A Subscribable is a named AsyncIterable — distinguishes a stream argument from
the other probe selector shapes (callables and `{ tags }` objects, neither of
which carries Symbol.asyncIterator).
*/
export function isSubscribable(value: unknown): value is Subscribable<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        Symbol.asyncIterator in value &&
        'name' in value
    )
}
