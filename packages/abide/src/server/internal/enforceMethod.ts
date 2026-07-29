// The method gate for a framework-generated route: answer `undefined` when the request's method is
// admitted, a 405 carrying `Allow` when it is not.
//
// This existed five times inside `dispatch`, written out per route class, and was MISSING from three
// more — `/openapi.json`, `/__abide/identity` and `/__abide/health` each answered a POST with a 200.
// That is the same shape as the `Allow`-header consolidation the router already did one layer up
// (`allowHeaderFor`, whose comment records that there were "five independent ones, none agreeing"):
// the header got one owner and the GATE did not, so the three routes that never spelled the check
// simply had none. A rule stated once and applied per-call-site is a rule the next route class forgets.
//
// `HEAD` is not admitted by naming it — a caller passes the methods it serves and `HEAD` rides along
// with `GET`, because HTTP `HEAD` IS `GET` minus the body and the router derives it everywhere else
// (ADR 0027 D6). Passing `'GET'` therefore yields `Allow: GET, HEAD`, which is what every read-only
// framework route wants and what none of them should have to remember to write.

import { errorResponse } from './errorResponse.ts'

export function enforceMethod(request: Request, allowed: readonly string[]): Response | undefined {
    const method = request.method.toUpperCase()
    const admits = allowed.includes('GET') ? [...allowed, 'HEAD'] : [...allowed]
    if (admits.includes(method)) return undefined
    return errorResponse(405, `Method not allowed: ${method}`, {
        headers: { allow: admits.join(', ') },
    })
}
