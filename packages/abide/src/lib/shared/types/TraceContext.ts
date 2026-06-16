/*
The request's W3C Trace Context position. `traceId` identifies the whole
end-to-end operation (inherited from an inbound `traceparent` or minted at the
boundary); `spanId` is the id abide mints for this request — it rides outbound
`traceparent` headers as the parent of downstream work, and a future span
exporter materialises the request's root span under this exact id.
`parentSpanId` preserves the inbound header's span id so that root span can
parent under the upstream caller; absent when abide started the trace.
`flags` echo the inbound sampling flags ('01' when abide starts the trace, so
downstream recorders don't drop what the developer is trying to see).
*/
export type TraceContext = {
    traceId: string
    spanId: string
    parentSpanId?: string
    flags: string
}
