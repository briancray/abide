// Baseline response-header hardening, applied to EVERY outgoing HTTP response at the router's single
// choke point (rpc-core; auth.md). Every rule is set only when the response did not already declare
// its own value, so a handler/helper (or middleware) stays in control — this fills the safe default.
//
// - `X-Content-Type-Options: nosniff` on everything (JSON APIs + served JS/CSS must never be sniffed).
// - `Referrer-Policy: strict-origin-when-cross-origin` — the modern browser default, made explicit.
// - `Strict-Transport-Security` in production only (dev is plain http; sending HSTS there would poison
//   `localhost`).
// - `X-Frame-Options: SAMEORIGIN` on HTML documents (clickjacking) — an app that must be framed
//   overrides it.
// - A DEFAULT cache posture of `private, no-cache` + `Vary: Cookie` for any response that did not set
//   its own `Cache-Control`. Content is identity-scoped by default (the abide-identity cookie), so a
//   SHARED cache must never hold it. Content-addressed assets opt OUT by declaring their own immutable
//   policy, so they keep their long cache and never get `Vary: Cookie`.

import { isProd } from './auth.ts'

// Append a token to `Vary` without duplicating one already present (case-insensitive).
export function appendVary(headers: Headers, value: string): void {
    const existing = headers.get('vary')
    if (existing === null) {
        headers.set('vary', value)
        return
    }
    if (existing === '*') return
    const present = existing.split(',').map((part) => part.trim().toLowerCase())
    if (!present.includes(value.toLowerCase())) headers.set('vary', `${existing}, ${value}`)
}

export function applyResponseHeaders(response: Response): Response {
    const headers = response.headers
    if (!headers.has('x-content-type-options')) headers.set('x-content-type-options', 'nosniff')
    if (!headers.has('referrer-policy'))
        headers.set('referrer-policy', 'strict-origin-when-cross-origin')
    if (isProd() && !headers.has('strict-transport-security'))
        headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains')
    // Case-insensitive: a `Content-Type` is a case-insensitive token, and `Text/HTML` must not slip past
    // the clickjacking guard (the CSRF gate in router.ts normalizes the same way).
    if (
        (headers.get('content-type') ?? '').toLowerCase().startsWith('text/html') &&
        !headers.has('x-frame-options')
    )
        headers.set('x-frame-options', 'SAMEORIGIN')
    if (!headers.has('cache-control')) {
        headers.set('cache-control', 'private, no-cache')
        appendVary(headers, 'Cookie')
    }
    return response
}
