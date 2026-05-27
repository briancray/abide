/*
Headers belte forwards from an inbound HTTP/MCP request onto every
synthesized in-process rpc Request — cookies + bearer auth + the four
forwarding hints proxies set when terminating TLS in front of the app.
defineVerb uses this when an SSR pass calls a verb in-process; the MCP
dispatcher uses it when piping a tool invocation through verb.fetch.

Centralised so both call sites can't drift on which headers are
considered "auth/identity" context.
*/
export const FORWARDED_HEADERS = [
    'cookie',
    'authorization',
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-host',
]

export function forwardHeaders(source: Headers): Headers {
    const headers = new Headers()
    for (const name of FORWARDED_HEADERS) {
        const value = source.get(name)
        if (value) {
            headers.set(name, value)
        }
    }
    return headers
}
