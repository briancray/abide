/**
 * Whether `error` is an abort, which was asked for — a superseded call's, a stopped stream's. 37.28.
 *
 * BY ITS TAG AS WELL AS ITS CLASS: an `AbortController` aborts with the runtime's own `DOMException`,
 * and where a DOM stands in for the global one — a test's — `instanceof` alone misses it.
 */
export function isAbort(error: unknown): boolean {
    return (
        (error instanceof DOMException ||
            Object.prototype.toString.call(error) ===
                '[object DOMException]') &&
        (error as DOMException).name === 'AbortError'
    )
}
