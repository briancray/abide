// Detach a CALLER from a run they stopped caring about (ADR 0028 D3). The returned promise rejects
// with the signal's reason as soon as it aborts; the underlying run is untouched and keeps going.
//
// That asymmetry is the decision, not an omission: `timeout` is the AUTHOR's statement that the work is
// worthless after T and so kills the run, while a caller's signal is the CALLER's statement that they
// stopped waiting. Killing the run here would strand every other caller coalesced onto the same memo
// slot and destroy a cache fill nobody asked to evict. The one place a caller's signal does cancel for
// real is a `memo: false` call, which has no slot and exactly one consumer — there the signal is handed
// straight to `fetch` instead of here.
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal === undefined) return promise
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        promise.then(
            (value) => {
                signal.removeEventListener('abort', onAbort)
                resolve(value)
            },
            (caught) => {
                signal.removeEventListener('abort', onAbort)
                reject(caught)
            },
        )
    })
}
