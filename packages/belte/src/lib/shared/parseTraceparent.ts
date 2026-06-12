import type { TraceContext } from './types/TraceContext.ts'

const TRACEPARENT_PATTERN = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

/*
Parses a W3C `traceparent` header into a TraceContext, or undefined when the
value is malformed (per spec, an unreadable header is ignored and the receiver
starts a fresh trace). Rejects the all-zero trace/span ids and the reserved
version 'ff'. The header's span id lands in `spanId`: from the wire's point of
view that field is "the id of the step that sent this" — callers minting their
own step id move it to `parentSpanId` (createTraceContext does).
*/
export function parseTraceparent(header: string): TraceContext | undefined {
    const match = TRACEPARENT_PATTERN.exec(header.trim().toLowerCase())
    if (!match) {
        return undefined
    }
    const [, version, traceId, spanId, flags] = match
    if (version === 'ff' || /^0+$/.test(traceId) || /^0+$/.test(spanId)) {
        return undefined
    }
    return { traceId, spanId, flags }
}
