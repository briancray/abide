// Detach a CALLER from a run they stopped caring about (ADR 0028 D3). The returned promise rejects
// with the signal's reason as soon as it aborts; the underlying run is untouched and keeps going.
//
// That asymmetry is the decision, not an omission: `timeout` is the AUTHOR's statement that the work is
// worthless after T and so kills the run, while a caller's signal is the CALLER's statement that they
// stopped waiting. Killing the run here would strand every other caller coalesced onto the same memo
// slot and destroy a cache fill nobody asked to evict. The one place a caller's signal does cancel for
// real is a `memo: false` call, which has no slot and exactly one consumer — there the signal is handed
// straight to `fetch` instead of here.

// The race itself, with the abort TERMINAL left to the caller. Two callers want the same detach and
// disagree only about what an abort means: this file's `withAbort` rejects (the caller is waiting on a
// value and there isn't one), while `agent.ts` resolves a sentinel (an abandoned approval is a decision
// the loop can act on, not an error). That difference is four characters; everything around it — arming
// the listener, removing it on BOTH terminals so an abort long after the promise settled doesn't retain
// a dead closure, and the already-aborted short-circuit — is the part worth having once.
//
// The short-circuit is why: returning early leaves `promise` with NO handler attached, so a later
// rejection is unhandled and, under strict unhandled-rejection modes, takes the process down. `agent.ts`
// discovered that and swallowed it locally; the copy here did not, and its callers are rpc reads, whose
// rejection is the ordinary case rather than the exotic one.
export function raceAbort<T>(
    promise: Promise<T>,
    signal: AbortSignal | undefined,
    onAbort: (reason: unknown) => T | Promise<T>,
): Promise<T> {
    if (signal === undefined) return promise
    if (signal.aborted) {
        void promise.catch(() => {})
        return Promise.resolve(onAbort(signal.reason))
    }
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => {
            try {
                resolve(onAbort(signal.reason))
            } catch (caught) {
                reject(caught)
            }
        }
        signal.addEventListener('abort', abort, { once: true })
        promise.then(
            (value) => {
                signal.removeEventListener('abort', abort)
                resolve(value)
            },
            (caught) => {
                signal.removeEventListener('abort', abort)
                reject(caught)
            },
        )
    })
}

export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    return raceAbort(promise, signal, (reason) => Promise.reject(reason) as Promise<T>)
}
