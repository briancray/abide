// Render a DELIBERATE outcome that left a handler by throwing — the one place `HttpError`/`Redirect`
// become a `Response`, so every transport surface answers them identically.
//
// Returns `undefined` for anything else, which is the caller's signal that the throw was an UNEXPECTED
// error and belongs to `onError`/500. That split is the whole point: a declared 404 or a login redirect
// is not a bug, so it must neither fire the app's error hook nor collapse into a generic 500 — which is
// what a thrown failure did before, arriving on the wire as a bare 500 with its status lost.
//
// Two callers that must agree: the router's `handleUncaught` (the HTTP path) and an rpc's `.raw()` (the
// in-process bypass, which hands back the untouched `Response` exactly as the browser proxy's `.raw()`
// does — no parse, no `!ok` throw).

import { HttpError } from '../../shared/HttpError.ts'
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
