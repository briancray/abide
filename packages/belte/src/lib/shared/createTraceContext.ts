import { parseTraceparent } from './parseTraceparent.ts'
import { randomHexId } from './randomHexId.ts'
import type { TraceContext } from './types/TraceContext.ts'

/*
Builds this request's trace position from an inbound `traceparent` header.
Prefer-incoming rule: a valid header keeps its trace id and sampling flags
(belte never overwrites a trace someone upstream started); the header's span
id becomes `parentSpanId`. Either way belte mints a fresh `spanId` for this
request — the one outbound hops carry as parent. No header (or a malformed
one) starts a new trace, sampled ('01') so downstream recorders keep it.
*/
export function createTraceContext(header: string | null | undefined): TraceContext {
    const incoming = header ? parseTraceparent(header) : undefined
    return {
        traceId: incoming?.traceId ?? randomHexId(16),
        spanId: randomHexId(8),
        parentSpanId: incoming?.spanId,
        flags: incoming?.flags ?? '01',
    }
}
