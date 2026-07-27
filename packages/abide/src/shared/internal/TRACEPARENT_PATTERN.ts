// W3C Trace Context (CO2.3): `version-traceid-spanid-flags`, all lower-case hex. Validates a
// traceparent arriving from OUTSIDE this process before it is adopted onto a scope — an incoming
// request header (server) or the hydration seed / `traceresponse` of a nav response (client).

export const TRACEPARENT_PATTERN = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/
