// Is this value a STREAM SOURCE — something a memo slot should fan out through a `ReplayableStream`
// rather than settle as a value?
//
// A `Response` and a `ReadableStream` are excluded deliberately: both are async-iterable in Bun, and
// both are things a handler returns to be TRANSPORTED verbatim, not drained into a transcript.
export function isStreamSource(value: unknown): value is AsyncIterable<unknown> {
    if (value === null || typeof value !== 'object') return false
    if (value instanceof Response || value instanceof ReadableStream) return false
    return (
        typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
    )
}
