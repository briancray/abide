// Render a failure as its HTTP response — the SERIALIZING half of transport (rpc-core §4).
//
// `error()` throws an `HttpError`; this is the one place that turns one into bytes, so the wire shape is
// stated once rather than per route class. Two callers: the router's own transport-layer rejections (a
// 405's `Allow`, a CSRF 403), which have a `Response` in hand and never had a value to lose, and
// `handleUncaught`, which renders a deliberate `HttpError` thrown by a handler or a middleware.
//
// The body is the shape the browser proxy decodes back into an `HttpError`: `{ status, statusText,
// message }` plainly, and for a typed error the narrowable `name`/`data` plus the `__typedError` marker.
// `kind` is what `fn.isError(e, name)` matches, and it round-trips through the body's `name`.

import type { HttpErrorOptions } from '../../shared/HttpError.ts'
import { reasonPhrase } from '../../shared/internal/reasonPhrase.ts'

export function errorResponse(
    status: number,
    message?: string,
    options?: HttpErrorOptions,
): Response {
    const statusText = options?.statusText ?? reasonPhrase(status)
    const kind = options?.kind
    const body =
        kind === undefined
            ? { status, statusText, message: message ?? statusText }
            : {
                  status,
                  statusText,
                  message: message ?? statusText,
                  error: kind,
                  name: kind,
                  data: options?.data,
                  __typedError: kind,
              }
    const headers = new Headers(options?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(body), { status, headers })
}
