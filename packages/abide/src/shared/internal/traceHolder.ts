// CLIENT TRACE HOLDER (CO2.3) — the reactive source `trace()` reads in the BROWSER.
//
// The third ADOPTED AMBIENT (see `adoptedAmbient.ts`), and the one that was NOT one until now. `route`
// and `identity` each had a reactive module-level holder; `trace` wrote a plain field on the reactive
// scope, so `{trace()}` in a binding rendered once and then showed a STALE id forever — it never woke
// when a navigation adopted a new one. Same lifecycle, same source of truth, different storage, and the
// difference was invisible until you rendered it.
//
// This changes ONLY the browser half. `trace()` still reads the request scope when one is active and
// still MINTS there — minting is request-scoped by ADR 0026, because only a unit of work that is itself
// a server request may name a trace. Nothing about the server path goes through here.
//
//   isValid — untrusted-shaped: the value arrives off the wire (a hydration seed, or a param-nav
//             confirm's `traceresponse` header), and the invariant callers rely on is "a valid
//             traceparent or undefined". A malformed one would ride into log lines and outgoing
//             headers, so it is DROPPED and the previous trace stands.
//   changed — default (identity). A traceparent is a string, so identity comparison IS value
//             comparison; re-adopting the same id wakes nobody.

import { adoptedAmbient } from './adoptedAmbient.ts'
import { TRACEPARENT_PATTERN } from './TRACEPARENT_PATTERN.ts'

const holder = adoptedAmbient<string>({
    isValid: (value): value is string =>
        typeof value === 'string' && TRACEPARENT_PATTERN.test(value),
})

// Reactive read of the adopted traceparent. Tracks when called inside an effect/memo.
export function readClientTrace(): string | undefined {
    return holder.read()
}

// Replace the adopted traceparent, waking every `trace()`-dependent binding.
export function setClientTrace(traceparent: string): void {
    holder.adopt(traceparent)
}

// Reset the holder (tests, and teardown that must not leak one run's trace into the next).
export function clearClientTrace(): void {
    holder.clear()
}
