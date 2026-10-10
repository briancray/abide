// A FAILURE, ANSWERED IN THE REPRESENTATION OF THE LANE IT HAPPENED IN: a page's is the nearest error
// page (35.2), a handler's is the refusal as Problem Details (15.21), and abide's own addresses and
// the listener answer as text (21.3). Which lane a request is in is the caller's to know; what each
// lane's failure looks like is decided here, once.

import { type Failed, problemOf } from '#shared/Failed.ts'
import { RENDER_LOG } from '#shared/log.ts'
import { coversPrefix, partsOf } from '#shared/matchRoute.ts'
import type { AppSources } from './answerRequest.ts'
import { DOCUMENT_HEADERS } from './DOCUMENT_HEADERS.ts'
import { boundPage, render } from './render.ts'
import { beginRender } from './requestScope.ts'

/** What a page's failure is painted from: the error pages, and the document they go into. */
export type ErrorPages = Pick<AppSources, 'errors' | 'errorDocument'>

type RankedError = ErrorPages['errors'][number]

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
 * 35.2 — every one whose directory is a prefix of the address, each segment meaning what it means
 * in a route.
 */
function errorsFor(errors: RankedError[], pathname: string): RankedError[] {
    // 15.16's address has no parts to be nearest to, so the root's page paints it.
    const parts = partsOf(pathname) ?? []
    const found: RankedError[] = []
    for (const error of errors)
        if (coversPrefix(error.segments, parts)) found.push(error)
    return found
}

/**
 * A refusal, painted by the nearest error page at the refusal's own status.
 *
 * 35.2, 35.3 — the page is rendered whole before a byte is answered, so one that fails is not
 * half-sent: it escalates to the next ancestor, and says so on `abide:render`. With none left,
 * the refusal is answered as text.
 */
export async function answerFailure(
    app: ErrorPages,
    pathname: string,
    failure: Failed<string, unknown>,
): Promise<Response> {
    const headers = new Headers(DOCUMENT_HEADERS)
    const status = failure.status
    for (const error of errorsFor(app.errors, pathname)) {
        try {
            const bound = boundPage(error, { failure: () => failure })
            beginRender(undefined)
            const document = await render(bound, app.errorDocument)
            return new Response(document, { status, headers })
        } catch (thrown) {
            RENDER_LOG.warning(
                `the error page for ${error.pattern} failed, so the next one answers`,
                thrown,
            )
        }
    }
    headers.set('content-type', 'text/plain; charset=utf-8')
    return new Response(failure.message, { status, headers })
}
