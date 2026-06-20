/*
Redirect Response with abide-friendly ergonomics — accepts relative
URLs (the platform's `Response.redirect` throws on them), defaults to
302, and matches the helper-style call site of `json`/`error` for
visual consistency inside a handler.

  return redirect('/login')              // 302 to /login
  return redirect('/articles/1', 301)    // permanent
  return redirect(externalUrl, 307)      // preserve method (POST stays POST)

Status guidance:
- 301 — moved permanently (cacheable; browsers may swap method to GET)
- 302 — found / temporary (default; browsers may swap method to GET)
- 303 — "after a POST, GET this" (forces GET on the follow-up)
- 307 — temporary, preserve method
- 308 — permanent, preserve method

A final `ResponseInit` adds headers (e.g. a `Set-Cookie` on the redirect);
the positional `status` always wins over any `init.status`.
*/
import { NO_STORE } from '../shared/CACHE_CONTROL_VALUES.ts'
import type { TypedResponse } from './rpc/types/TypedResponse.ts'
import { withResponseDefaults } from './runtime/withResponseDefaults.ts'

type RedirectStatus = 301 | 302 | 303 | 307 | 308

/*
Return type is `TypedResponse<never>` for the same reason `error()` is —
the wire response is a 3xx with no body the caller resolves to, so it
must not pollute the inferred `Return` of a route that conditionally
redirects vs returns json.
*/
// @documentation response
export function redirect(
    url: string,
    status: RedirectStatus = 302,
    init?: ResponseInit,
): TypedResponse<never> {
    return new Response(
        null,
        withResponseDefaults(init, { Location: url, 'Cache-Control': NO_STORE }, status),
    ) as TypedResponse<never>
}
