// Render a DELIBERATE outcome that left a handler by throwing — the one place `HttpError`/`Redirect`
// become a `Response`, so every transport surface answers them identically.
//
// Returns `undefined` for anything else, which is the caller's signal that the throw was an UNEXPECTED
// error and belongs to `onError`/500. That split is the whole point: a declared 404 or a login redirect
// is not a bug, so it must neither fire the app's error hook nor collapse into a generic 500 — which is
// what a thrown failure did before, arriving on the wire as a bare 500 with its status lost.
//
// Two callers that must agree: the router's `handleUncaught` (the HTTP path) and an rpc's `.raw()` (the
// same read encoded in-process, which hands back the outcome as a `Response` exactly as the browser
// proxy's `.raw()` does — no parse, no `!ok` throw).

import { HttpError } from '../../shared/HttpError.ts'
import { isTimeoutError } from '../../shared/internal/isTimeoutError.ts'
import { log } from '../../shared/log.ts'
import { Redirect } from '../../shared/Redirect.ts'
import { errorResponse } from './errorResponse.ts'

export function outcomeResponse(caught: unknown): Response | undefined {
    // A redirect is not an error at all — it is a navigation that left the value channel by throwing.
    if (caught instanceof Redirect) {
        const headers = new Headers(caught.headers)
        headers.set('location', caught.url)
        return new Response(null, { status: caught.status, headers })
    }
    if (caught instanceof HttpError) {
        return errorResponse(caught.status, caught.message, {
            statusText: caught.statusText,
            kind: caught.kind,
            data: caught.data,
            headers: caught.headers,
        })
    }
    return undefined
}

// A TRIPPED RUN DEADLINE — the outcome that is not deliberate and is not a bug either, so both response
// surfaces answer it before the generic 500 (ADR 0028 D7). Returns `undefined` for anything else, exactly
// as `outcomeResponse` does, so a caller's ladder reads as one sequence of "is it this? is it that?".
//
// It lives here, with the telemetry inside it, because there are now two doors: the router's
// `handleUncaught` and `fn.raw` — which is the SAME read, encoded in-process rather than over HTTP, and
// must therefore answer a trip with the same 504 a browser `.raw` receives for it. Spelled out at each
// door, the second copy would be one status literal and one missing `kind` away from the two disagreeing,
// and `fn.isError(e, 'TimeoutError')` narrows on that `kind`.
//
// 504, not 408 — 408 says the CLIENT was slow sending its request; here the server was slow producing.
export function timeoutResponse(caught: unknown): Response | undefined {
    if (!isTimeoutError(caught)) return undefined
    log.channel('abide:rpc').warn('run exceeded its timeout:', caught)
    return errorResponse(504, undefined, { kind: 'TimeoutError' })
}
