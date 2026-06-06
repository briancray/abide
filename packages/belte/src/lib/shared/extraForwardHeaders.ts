/*
App-configured inbound header names to forward onto in-process rpc Requests,
on top of the built-in FORWARDED_HEADERS. Set once at boot from
app.forwardHeaders so the SSR in-process path (defineVerb) and the MCP
dispatcher honour the same list without re-reading app config per call. A
module-level slot rather than threaded config because both call sites are deep
in the request path and the value is fixed for the process lifetime.
*/
let names: readonly string[] = []

export const extraForwardHeaders = {
    get: (): readonly string[] => names,
    set: (configured: readonly string[]): void => {
        names = configured
    },
}
