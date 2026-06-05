/*
True when a WebSocket upgrade carries a browser Origin that doesn't match the
request's own host — the cross-site WebSocket hijacking (CSWSH) shape. A
mismatched Origin means another site is trying to open the socket in a visitor's
authenticated browser. Native clients (CLI, MCP) send no Origin, so an absent
header is allowed; only a present-and-mismatched (or unparseable) Origin is
rejected. An unparseable Origin is treated as cross-origin (fail closed).
*/
export function isCrossOriginUpgrade(request: Request, requestUrl: URL): boolean {
    const origin = request.headers.get('origin')
    if (!origin) {
        return false
    }
    try {
        return new URL(origin).host !== requestUrl.host
    } catch {
        return true
    }
}
