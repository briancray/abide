// Adopt a traceparent minted by the SERVER onto the active scope, so `trace()` on the CLIENT returns
// the trace of the request that produced the page (CO2.3). The browser never mints one of its own —
// a client-generated id would name a trace no server span belongs to — so the value always arrives
// from outside: the hydration seed (first load + a full soft-nav) or the `traceresponse` header of a
// param/query nav's confirm response.
//
// Untrusted-shaped input by construction (it comes off the wire / out of the document), so a value
// that is not a well-formed traceparent is DROPPED rather than adopted: the invariant `trace()`
// callers rely on is "a valid traceparent or undefined", and a malformed one would ride into log
// lines and outgoing headers. A drop leaves the previous trace standing.

import { reactiveScope } from './reactiveScope.ts'
import { TRACEPARENT_PATTERN } from './TRACEPARENT_PATTERN.ts'

export function adoptTrace(traceparent: string | null | undefined): void {
    if (traceparent === null || traceparent === undefined) return
    if (!TRACEPARENT_PATTERN.test(traceparent)) return
    reactiveScope().traceparent = traceparent
}
