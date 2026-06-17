import { extraForwardHeaders } from './extraForwardHeaders.ts'

/*
Headers abide forwards from an inbound HTTP/MCP request onto every
synthesized in-process rpc Request — cookies + bearer auth + the four
forwarding hints proxies set when terminating TLS in front of the app.
defineVerb uses this when an SSR pass calls a verb in-process; the MCP
dispatcher uses it when piping a tool invocation through verb.fetch.

WARNING — this is an allowlist: every inbound header NOT named here (and
not added via app.forwardHeaders) is DROPPED on the in-process path. A
handler that reads e.g. `accept-language`, an idempotency key, a trace
header, or a custom `x-tenant-*` during SSR or an MCP call sees nothing,
and the call still succeeds with a degraded request. Add the names you
rely on via the `forwardHeaders` export in src/app.ts.

Centralised so both call sites can't drift on which headers are
considered "auth/identity" context.
*/
const FORWARDED_HEADERS = [
    'cookie',
    'authorization',
    /* W3C trace context rides every hop so a handler reading headers sees the caller's position. */
    'traceparent',
    'tracestate',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-host',
]

export function forwardHeaders(source: Headers): Headers {
    const headers = new Headers()
    // Iterate the two fixed arrays directly — both are request-invariant, so
    // a spread-concat here would allocate a fresh array on every SSR/MCP call.
    const copy = (name: string) => {
        const value = source.get(name)
        if (value) {
            headers.set(name, value)
        }
    }
    FORWARDED_HEADERS.forEach(copy)
    extraForwardHeaders.get().forEach(copy)
    return headers
}
