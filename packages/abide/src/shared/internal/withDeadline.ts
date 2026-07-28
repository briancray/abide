import { isThenable } from './isThenable.ts'

// Bound a pending run by a deadline (ADR 0028). Rejects with the PLATFORM's own timeout reason — the
// `DOMException` named `TimeoutError` that `AbortSignal.timeout` aborts with — so nothing here mints an
// error type: `fn.isError(e, 'TimeoutError')` already narrows on `.name`, and the client-side abort
// produces the identical value from the identical API.
//
// `ms` of 0/Infinity/non-finite is the declared opt-out (D9) and returns the input untouched, so an
// unbounded rpc pays no timer and no wrapper promise. An ALREADY-SETTLED value is likewise handed back
// as-is rather than wrapped — a warm/synchronous handler is the common shape and must not pay a promise
// allocation plus a microtask tick for a clock it can never trip.
export function withDeadline<T>(value: Promise<T> | T, ms: number): Promise<T> | T {
    if (!isThenable(value)) return value
    if (!Number.isFinite(ms) || ms <= 0) return value as Promise<T>
    const promise = value as Promise<T>
    const signal = AbortSignal.timeout(ms)
    return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        // Detach on settle. Left attached, a long-lived listener on a still-armed signal keeps both the
        // signal and this promise's closure reachable for the rest of the window — on a hot rpc that is a
        // retained allocation per call rather than per timeout.
        promise.then(
            (settled) => {
                signal.removeEventListener('abort', onAbort)
                resolve(settled)
            },
            (caught) => {
                signal.removeEventListener('abort', onAbort)
                reject(caught)
            },
        )
    })
}
