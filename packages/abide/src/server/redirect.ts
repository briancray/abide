// Redirect response helper (rpc-core §4). Sets Location and a 3xx status (default 302).

import type { OutcomeResponse } from '../shared/internal/responseSource.ts'

// Typed as an `OutcomeResponse` — still an ordinary `Response`, but marked as an outcome rather than a
// value, so a handler that redirects on one path does not widen its success payload to `Response | T`.
export function redirect(
    url: string,
    status: 301 | 302 | 303 | 307 | 308 = 302,
    init?: ResponseInit,
): OutcomeResponse {
    const headers = new Headers(init?.headers)
    headers.set('location', url)
    return new Response(null, { ...init, status, headers }) as OutcomeResponse
}
