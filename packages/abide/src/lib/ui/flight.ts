/*
Server-only flight-starter behind the SSR codegen's `$$flight` alias (ADR-0034). The
SSR back-end hoists a *hoistable* await's promise into the synchronous render prefix as
`const $flightN = $$flight(() => (<promise expr>))`, so the flight is already in-flight
when the body walk reaches its blocking `await $flightN` / streaming `promise: () =>
$flightN` — independent flights overlap instead of serializing (prefix → barrier → body
→ drain). Server-only: the client build never emits `$$flight`, so it tree-shakes out of
the browser bundle (like `$$settleAsyncCells`).

Two behaviours the raw promise expression can't provide on its own:

- A SYNCHRONOUS throw in the loader (before it returns a promise) is normalised to a
  rejected promise, so a hoisted flight's throw still lands in the block's `{:catch}` /
  500 path exactly as an inline `await (expr)` would — the expression no longer evaluates
  inside the block's try/catch, so the thunk wrapper restores that reach.
- A no-op rejection KEEPER (`.then(undefined, () => {})`) so a flight that rejects in the
  window before its real consumer (the inline await / the `renderToStream` drain) attaches
  a handler is never a Bun-fatal unhandled rejection. The keeper is an independent branch
  that never consumes the rejection for the real consumer, so the block's
  surface-rejection → 500 / catch-branch semantics are unchanged. Mirrors the inline
  `.then(onValue, onError)` guard in `createAsyncCell`.
*/
// @documentation plumbing
export function flight(thunk: () => unknown): FlightPromise {
    let promise: Promise<unknown>
    try {
        promise = Promise.resolve(thunk())
    } catch (error) {
        promise = Promise.reject(error)
    }
    /* Synchronous settledness signal (ADR-0039): the post-walk `finalizeStreamedChildren` reads
       `.settled` to decide inline-vs-stream — a child flight that already resolved by finalize time
       inlines its html into the shell (byte-identical to today), a still-pending one streams. Set
       alongside the no-op keeper below, on the same settle. */
    const flightPromise = promise as FlightPromise
    flightPromise.settled = false
    promise.then(
        (value) => {
            flightPromise.value = value
            flightPromise.settled = true
        },
        (error) => {
            flightPromise.error = error
            flightPromise.settled = true
        },
    )
    promise.then(undefined, () => {})
    return flightPromise
}

/* A flight promise carrying a synchronous settledness snapshot for `finalizeStreamedChildren`. */
export type FlightPromise = Promise<unknown> & {
    settled: boolean
    value?: unknown
    error?: unknown
}
