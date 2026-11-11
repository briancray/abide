// A FAILURE, ANSWERED IN THE REPRESENTATION OF THE LANE IT HAPPENED IN: a page's is the nearest error
// page (35.2), a handler's is the refusal as Problem Details (15.21), and abide's own addresses and
// the listener answer as text (21.3). Which lane a request is in is the caller's to know; what each
// lane's failure looks like is decided here, once.

import { type Failed, problemOf } from '#shared/Failed.ts'
import { RENDER_LOG } from '#shared/log.ts'
import { coversPrefix, partsOf } from '#shared/matchRoute.ts'
import { coversRoute, parseRoutePattern } from '#shared/routePattern.ts'

import type { AppSources, RankedError } from './answerRequest.ts'
import { compressAnswer } from './compressAnswer.ts'
import { DOCUMENT_HEADERS } from './DOCUMENT_HEADERS.ts'
import { leavePageRender } from './PageRender.ts'
import { prefers } from './prefers.ts'
import { boundPage, renderDocument } from './render.ts'
import { currentRequestScope } from './requestScope.ts'

/** What a page's failure is painted from: the error pages, and the document they go into. */
export type ErrorPages = Pick<AppSources, 'errors' | 'errorDocument'>

/**
 * The headers a handler's answer starts from: JSON, never stored, varying on `Origin`.
 *
 * 21.7 — whether it is another origin's to read, and whether a mutation from one is refused, both
 * depend on `Origin`, however this one came.
 */
export function handlerHeaders(): Headers {
    return new Headers({
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
        vary: 'origin',
    })
}

/**
 * The `Response` a refusal is answered with.
 *
 * 15.1 — a refusal crosses the wire as Problem Details (RFC 9457), at its own status.
 */
export function answered(failure: Failed<string, unknown>): Response {
    const headers = handlerHeaders()
    headers.set('content-type', 'application/problem+json')
    return new Response(JSON.stringify(problemOf(failure)), {
        status: failure.status,
        headers,
    })
}

/**
 * The error pages for `pathname`, nearest first.
 *
 * 35.2 — AS A LAYOUT IS: over the route the request matched, every one whose route covers it, as
 * a layout's and an `onError`'s does (35.1, 37.5). An address no route matched has only its path,
 * and every one whose directory is a prefix of it answers, each segment meaning what it means in a
 * route.
 */
function errorsFor(errors: RankedError[], pathname: string): RankedError[] {
    const route = currentRequestScope()?.route
    const found: RankedError[] = []
    if (route !== undefined) {
        const segments = parseRoutePattern(route)
        for (const error of errors)
            if (coversRoute(error.segments, segments)) found.push(error)
        return found
    }
    // 15.16's address has no parts to be nearest to, so the root's page paints it.
    const parts = partsOf(pathname) ?? []
    for (const error of errors)
        if (coversPrefix(error.segments, parts)) found.push(error)
    return found
}

/**
 * A refusal, painted by the nearest error page at the refusal's own status.
 *
 * 35.2, 35.3 — the page is rendered whole before a byte is answered, so one that fails is not
 * half-sent: it escalates to the next ancestor, and says so on `abide:render`. With none left,
 * the refusal is answered as text. 38.29 — the painted page is a document, in the encoding
 * `request` takes.
 */
export async function answerFailure(
    app: ErrorPages,
    pathname: string,
    failure: Failed<string, unknown>,
    request: Request,
): Promise<Response> {
    const headers = new Headers(DOCUMENT_HEADERS)
    const status = failure.status
    for (const error of errorsFor(app.errors, pathname)) {
        let document: Uint8Array<ArrayBuffer>
        try {
            const bound = boundPage(error, { failure: () => failure })
            leavePageRender()
            document = await renderDocument(bound, app.errorDocument)
        } catch (thrown) {
            RENDER_LOG.warning(
                `the error page for ${error.pattern} failed, so the next one answers`,
                thrown,
            )
            continue
        }
        return compressAnswer(document, request, headers, status)
    }
    headers.set('content-type', 'text/plain; charset=utf-8')
    return new Response(failure.message, { status, headers })
}

/**
 * A failure at an address whose lane only the request can say: a page's, painted, where it prefers
 * a document, and a handler's otherwise. 15.22.
 */
export function laneFailure(
    app: ErrorPages,
    pathname: string,
    failure: Failed<string, unknown>,
    request: Request,
): Response | Promise<Response> {
    return prefers(request, 'text/html', 'application/json')
        ? answerFailure(app, pathname, failure, request)
        : answered(failure)
}
