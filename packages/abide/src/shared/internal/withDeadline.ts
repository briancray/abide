import { isThenable } from './isThenable.ts'
import { withAbort } from './withAbort.ts'

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
    // A deadline IS an abort the author owns rather than the caller, so the race — including the
    // detach-on-settle that stops a still-armed signal retaining this closure for the rest of the
    // window — is `withAbort`'s, not a second copy of it. `AbortSignal.timeout(ms > 0)` is never
    // already aborted, so `withAbort`'s pre-check is inert here.
    return withAbort(value as Promise<T>, AbortSignal.timeout(ms))
}
