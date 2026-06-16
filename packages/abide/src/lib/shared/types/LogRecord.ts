/*
One log event, built once per emission and rendered by either formatter
(tab-separated tsv line or ABIDE_LOG_FORMAT=json). The json rendering of these
keys is a documented contract — ingestion pipelines (Splunk, Loki) extract
fields by these names, so renames are breaking changes. Absent context is
omitted, never null: trace/elapsedMs/method/path exist only inside a request
scope, status/durationMs only on closing request records, name/spanId only on
log.trace operation records, stack only when an Error was captured.
*/
export type LogRecord = {
    /* Epoch ms; the json format renders it as an ISO timestamp. */
    ts: number
    level: 'info' | 'warn' | 'error'
    msg: string
    /* DEBUG-gated diagnostic channel that emitted this record. */
    channel?: string
    /* Full 32-hex trace id; tsv mode prints the first 8 chars. */
    trace?: string
    /* The emitting request's own trace span id (TraceContext.spanId). Stable across
       every record one request emits, so a consumer can split a multi-request trace
       (a propagated session) back into its individual requests. */
    requestSpan?: string
    /* The span this request descends from (TraceContext.parentSpanId); absent when
       abide started the trace — the journey's root request. Lets a consumer nest
       requests within a trace. */
    parentSpan?: string
    /* Ms since the request scope opened (navigation start in the browser). */
    elapsedMs?: number
    method?: string
    path?: string
    /* Structured payload passed as the second argument. */
    data?: unknown
    /* Closing request record: response status + total duration at settle. */
    status?: number
    durationMs?: number
    /* Closing request record: the request's cache read tallies, frozen at settle. */
    cache?: { hits: number; misses: number; coalesced: number }
    /* log.trace operation record: chosen operation name + minted span id. */
    name?: string
    spanId?: string
    stack?: string
}
