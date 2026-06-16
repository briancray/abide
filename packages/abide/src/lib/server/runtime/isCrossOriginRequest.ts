/*
True when the request carries a browser Origin that doesn't match the
request's own host — the cross-site request forgery shape, in both its
WebSocket form (CSWSH) and its HTTP form (a hostile page firing a form post
or no-preflight fetch at an rpc/MCP URL inside a visitor's authenticated
browser, ambient cookies attached). Native clients (CLI, MCP, curl) send no
Origin, so an absent header is allowed; only a present-and-mismatched (or
unparseable) Origin is rejected. An unparseable Origin is treated as
cross-origin (fail closed). `requestUrl` lets a caller that already parsed
the URL pass it in; otherwise the parse is deferred until an Origin is
actually present, keeping the no-Origin hot path allocation-free.
*/
export function isCrossOriginRequest(request: Request, requestUrl?: URL): boolean {
    const origin = request.headers.get('origin')
    if (!origin) {
        return false
    }
    try {
        return new URL(origin).host !== (requestUrl ?? new URL(request.url)).host
    } catch {
        return true
    }
}
