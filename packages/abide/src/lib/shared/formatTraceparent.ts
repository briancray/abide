import type { TraceContext } from './types/TraceContext.ts'

// Serialises a TraceContext to the W3C `traceparent` wire form (version 00).
export function formatTraceparent(context: TraceContext): string {
    return `00-${context.traceId}-${context.spanId}-${context.flags}`
}
