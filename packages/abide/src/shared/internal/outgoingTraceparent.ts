// The `traceparent` header value for a call the CLIENT makes into the server (CO2.3): the current
// trace id and flags, with a FRESH span id. This is what W3C Trace Context asks of a caller — the
// `parent-id` field is "the id of this request as known by the caller", so each outgoing call names
// its own span rather than re-sending the one it is sitting inside. Re-sending the page's span id
// would collapse every RPC a page makes into one span and lose the causal shape entirely.
//
// The server propagates a well-formed incoming traceparent verbatim, so the id minted here IS the id
// the RPC's server work reports — caller and callee agree on the span's name, and it hangs under the
// same trace as the page that called it.
//
// Returns undefined when there is nothing to be inside: no scope, or a browser that has not adopted a
// page trace yet. The caller then sends NO header and the server mints a fresh trace, which is the
// correct answer for an unparented call — never a locally invented "child" of nothing.

import { trace } from '../trace.ts'
import { randomHex } from './randomHex.ts'
import { TRACEPARENT_PATTERN } from './TRACEPARENT_PATTERN.ts'

export function outgoingTraceparent(): string | undefined {
    const current = trace()
    if (current === undefined || !TRACEPARENT_PATTERN.test(current)) return undefined
    // `version-traceid-spanid-flags` — keep all but the span id. Sampling flags are carried through
    // unchanged: a caller re-deciding sampling mid-trace is what produces half-recorded traces.
    const parts = current.split('-')
    return `${parts[0]}-${parts[1]}-${randomHex(8)}-${parts[3]}`
}
