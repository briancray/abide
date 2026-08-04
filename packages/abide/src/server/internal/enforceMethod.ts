// The method gate for EVERY route the framework answers: `undefined` when the request's method is
// admitted, a 405 carrying `Allow` when it is not.
//
// This existed five times inside `dispatch`, written out per route class, and was MISSING from three
// more — `/openapi.json`, `/__abide/identity` and `/__abide/health` each answered a POST with a 200.
// That is the same shape as the `Allow`-header consolidation the router did one layer up: the header
// got one owner and the GATE did not, so the three routes that never spelled the check simply had none.
// A rule stated once and applied per-call-site is a rule the next route class forgets.
//
// The consolidation then stopped at the framework endpoints, and the four TRANSPORT surfaces kept
// private copies — the rpc verb gate re-implemented the HEAD rule inline, and the socket HTTP face,
// the public-file route and the MCP endpoint each hand-rolled a 405 with its own `Allow` literal. All
// four now ask this gate, so `Allow` has exactly one derivation and there is no second statement of
// what `HEAD` means. The header builder is exported too, because the ONE caller that cannot use the
// gate — an `OPTIONS` preflight to an rpc that declared no `crossOrigin`, which is a 405 by
// construction rather than by comparison — must still produce the identical header.
//
// `HEAD` is never admitted by naming it. A caller passes the methods it SERVES and `HEAD` rides along
// with `GET`, because HTTP `HEAD` IS `GET` minus the body and the router derives it everywhere else
// (ADR 0027 D6). Passing `'GET'` therefore yields `Allow: GET, HEAD`, which is what every read-only
// route wants and what none of them should have to remember to write.

import { errorResponse } from './errorResponse.ts'

// The methods a route admits, with `HEAD` derived. Placed immediately after `GET` so the header reads
// the way it is spoken (`GET, HEAD, POST`).
function admitted(allowed: readonly string[]): string[] {
    const methods: string[] = []
    for (const method of allowed) {
        methods.push(method)
        if (method === 'GET') methods.push('HEAD')
    }
    return methods
}

function allowHeader(allowed: readonly string[]): string {
    return admitted(allowed).join(', ')
}

// The 405 itself, for a caller whose method is rejected by construction rather than by comparison.
export function methodNotAllowed(method: string, allowed: readonly string[]): Response {
    return errorResponse(405, `Method not allowed: ${method}`, {
        headers: { allow: allowHeader(allowed) },
    })
}

export function enforceMethod(request: Request, allowed: readonly string[]): Response | undefined {
    const method = request.method.toUpperCase()
    if (admitted(allowed).includes(method)) return undefined
    return methodNotAllowed(method, allowed)
}
