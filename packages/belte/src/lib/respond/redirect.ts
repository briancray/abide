/*
Redirect Response with belte-friendly ergonomics — accepts relative
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
*/
type RedirectStatus = 301 | 302 | 303 | 307 | 308

export function redirect(url: string, status: RedirectStatus = 302): Response {
    return new Response(null, {
        status,
        headers: {
            Location: url,
            'Cache-Control': 'no-store',
        },
    })
}
