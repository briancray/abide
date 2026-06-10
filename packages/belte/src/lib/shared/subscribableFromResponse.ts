import { streamResponse } from './streamResponse.ts'
import type { Subscribable } from './types/Subscribable.ts'

/*
Builds the Subscribable returned by `fn.stream(args)`. The carried
`name` is the cache-style key for (method, url, args) so tail()
dedupes multiple readers of identical args into one underlying
fetch. The fetch is deferred until the first iterator pull so
constructing the Subscribable (which happens on every $derived
re-evaluation) doesn't open a connection — tail()'s registry
short-circuits the second instance before it iterates.
*/
export function subscribableFromResponse<T>(
    name: string,
    fetchResponse: () => Promise<Response>,
): Subscribable<T> {
    return {
        name,
        [Symbol.asyncIterator]() {
            let inner: AsyncIterator<T, void, undefined> | undefined
            let cancelled = false
            return {
                async next() {
                    if (cancelled) {
                        return { value: undefined, done: true }
                    }
                    if (!inner) {
                        const response = await fetchResponse()
                        inner = streamResponse<T>(response)[Symbol.asyncIterator]()
                        /*
                        If return() landed while we were awaiting the
                        fetch, `inner` was still undefined then so its
                        reader was never cancelled — release the body now
                        rather than leaving the HTTP stream open.
                        */
                        if (cancelled) {
                            await inner.return?.(undefined)
                            return { value: undefined, done: true }
                        }
                    }
                    return inner.next()
                },
                async return() {
                    cancelled = true
                    await inner?.return?.(undefined)
                    return { value: undefined, done: true }
                },
            }
        },
    }
}
