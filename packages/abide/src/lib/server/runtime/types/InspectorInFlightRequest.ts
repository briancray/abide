/*
One in-flight request projected for the inspector — the serializable facts the
In-flight tab renders for a handler that's currently executing. The held Request
and CacheStore aren't included; what an operator wants is which request it is,
how long it's been running, and where it landed in routing.
*/
export type InspectorInFlightRequest = {
    /* The W3C trace id, so the row links to the same trace the Logs/Traces tabs group by. */
    trace: string
    /* HTTP method of the inbound request. */
    method: string
    /* Request path with query string (app-space, as logged). */
    path: string
    /* Ms the handler has been running, measured from scope entry to snapshot time. */
    elapsedMs: number
    /* The matched page route pattern, once routing has landed; undefined on rpc/socket requests or before a match. */
    route: string | undefined
    /* The matched route's decoded params, when a page route landed. */
    params: Record<string, string> | undefined
}
