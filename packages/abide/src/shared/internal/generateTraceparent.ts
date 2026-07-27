// A fresh W3C Trace Context `traceparent` (CO2.3): version `00`, 16-byte trace id, 8-byte span id,
// sampled flag `01`, all lower-case hex. A NEW TRACE — the router mints one per non-asset request
// that arrived without a traceparent, and `trace()` mints one lazily for a scope that never went
// through the router. To stay INSIDE a trace (an outgoing call from a page), use
// `outgoingTraceparent` instead: same trace id, new span id.

import { randomHex } from './randomHex.ts'

export function generateTraceparent(): string {
    return `00-${randomHex(16)}-${randomHex(8)}-01`
}
