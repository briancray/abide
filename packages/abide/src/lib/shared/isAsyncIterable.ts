/*
Any async iterable — a stream cell auto-tracks by consuming `Symbol.asyncIterator` alone, so
it needs no `name` (unlike `isSubscribable`, which the probe registry keys on the name). A
plain `async function*` generator qualifies here where the named check would reject it.
*/
export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return value != null && typeof (value as any)[Symbol.asyncIterator] === 'function'
}
