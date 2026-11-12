// 16.2 — A HANDLER, ANSWERED OVER HTTP. The call is `invokeHandler`'s, made in a request's own scope
// (11.32), and what this module adds is the transport either side of it: the args off the request,
// and the answer onto a response.
//
// WIRE-ONLY, per 16.13: `maxBodySize`, the `crossOrigin` preflight, and the text a URL or a form
// carried the args as.

import { CONTINUE_HEADER } from '#shared/CONTINUE_HEADER.ts'
import { type Failed, isFailed } from '#shared/Failed.ts'
import { framingOf } from '#shared/framing.ts'
import { isRecord } from '#shared/isRecord.ts'
import { mounted as underMount } from '#shared/mount.ts'
import { PRINCIPAL_HEADER } from '#shared/PRINCIPAL_HEADER.ts'
import { deadlineOf } from '#shared/reactive/producer.ts'
import { notFound, refuse } from '#shared/refuse.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import { argsInURL } from '#shared/rpcRequest.ts'
import { VERSION_HEADER } from '#shared/VERSION_HEADER.ts'
import { versionInEtag } from '#shared/versionInEtag.ts'

import {
    answered,
    answerFailure,
    type ErrorPages,
    handlerHeaders,
} from './answerFailure.ts'
import { answerValue, isValues, namesEtag, sseHeaders } from './answerValue.ts'
import { collapsed } from './argsContract.ts'
import { callerCookieOf } from './callerOf.ts'
import { ownOrigin, positiveSetting } from './config.ts'
import { allows, crossingOrigin } from './crossingOrigin.ts'
import { handedOff } from './handedOff.ts'
import { failureOf } from './hooks.ts'
import { type Invocation, invokeHandler, originGate } from './invokeHandler.ts'
import type { Mounted } from './mountHandlers.ts'
import { OFFLINE_STALE } from './OFFLINE_STALE.ts'
import { prefers } from './prefers.ts'
import { currentRequestScope, unreap, writtenStatus } from './requestScope.ts'
import type { Outcome } from './seedBuffer.ts'
import { versionOf } from './versionOf.ts'

/**
 * The `Response` to a call of `found` made over http, `params` being what its route matched.
 *
 * `found` answers the request's method — or, for an `OPTIONS`, the method its preflight asks
 * about: which handler a request reaches is the route table's to say (19.20).
 */
export async function answerRpc(
    found: Mounted,
    params: Record<string, string | string[]>,
    url: URL,
    request: Request,
    // 16.38 — what paints a refusal for a request that came as a navigation.
    pages: ErrorPages,
    // 21.22 — whether the device keeps what is answered.
    offline: boolean,
): Promise<Response> {
    const pathname = url.pathname
    const origin = request.headers.get('origin')
    // 16.24 — THE PREFLIGHT, answered by abide where the handler declared `crossOrigin`.
    if (request.method === 'OPTIONS')
        return origin !== null && allows(found.handler.crossOrigin, origin)
            ? preflight(found, origin, request)
            : answered(notFound({ path: pathname, method: request.method }))
    const inUrl = argsInURL(found.method)
    const form = isForm(request)
    // 21.19 — the origin the answer admits, where the handler declared it may read.
    const admitted = originGate(
        found.handler,
        crossingOrigin(origin, url),
        false,
    )
    if (isFailed(admitted)) return answered(admitted)
    const raw = await argsOf(
        request,
        url,
        inUrl,
        form,
        found.handler.maxBodySize,
    )
    if (isFailed(raw)) return answered(raw)
    // A URL's and a form's args are text, and the query tells a bare name from `name=` (19.7).
    // 16.50 — a `HEAD` is the `GET`'s answer, which the server sends without its body; 16.51 — and
    // it leaves the seed for the `GET` it stands in front of.
    const invoked = await invokeHandler(
        found,
        raw,
        inUrl ? url.search : form ? '' : undefined,
        params,
        request.method !== 'HEAD',
    )
    if (isFailed(invoked)) return answered(invoked)
    const outcome = invoked.outcome
    // 16.38 — A MUTATION A DOCUMENT MADE — a form posted with no script — is answered as a navigation.
    if (!inUrl && prefers(request, 'text/html', 'application/json'))
        return navigated(outcome, request, pathname, pages)
    const answer = await answerOutcome(invoked, request, found, offline)
    // A `Response` the handler built is its own — but the origin answer below is laid over it, so it
    // varies on `Origin` too (21.7), which `handlerHeaders` never reached.
    if (outcome.settled && outcome.value instanceof Response)
        answer.headers.append('vary', 'origin')
    else invoked.timed()
    // 16.97 — AN EARLY CALL OF A STREAM goes over http to its first chunk, and over the mux after it.
    return admitting(
        // 16.97 — and only where the rest can be filed under who asked, as it was when it asked: a
        // request with a caller, whose answer writes no cookie and signs no one in or out.
        request.headers.has(CONTINUE_HEADER) &&
            answer.status === 200 &&
            answer.body !== null &&
            framingOf(answer.headers.get('content-type')) === 'jsonl' &&
            callerCookieOf(request) !== undefined &&
            !answer.headers.has('set-cookie') &&
            !answer.headers.has(PRINCIPAL_HEADER)
            ? handedOff(answer, request)
            : answer,
        admitted,
    )
}

/** The answer with the crossing origin allowed, where the handler admits it. 21.19. */
function admitting(answer: Response, admitted: string | null): Response {
    if (admitted !== null)
        answer.headers.set('access-control-allow-origin', admitted)
    return answer
}

async function answerOutcome(
    invoked: Invocation,
    request: Request,
    found: Mounted,
    offline: boolean,
): Promise<Response> {
    const { outcome, entry } = invoked
    if (!outcome.settled) return answered(failureOf(outcome.error))
    const value = outcome.value
    // The `global` value the answer came from, or `undefined` for one built per request. 18.22 — or
    // for one whose production has moved past what is answered: a seeded answer is what the render
    // reached (41.13). 18.23 — or for a binary.
    const serving =
        entry !== undefined &&
        !(
            value instanceof Blob ||
            value instanceof ArrayBuffer ||
            ArrayBuffer.isView(value)
        ) &&
        (isValues(value) || (entry as { peek(): unknown }).peek() === value)
            ? entry
            : undefined
    // 21.3 — what the handler wrote through `response` is laid over it at the exit (21.10).
    const headers = handlerHeaders()
    // When the production answered stops being servable, or Infinity where nothing bounds it.
    const deadline =
        serving === undefined ? Number.POSITIVE_INFINITY : deadlineOf(serving)
    // 18.5 — the version a follower resumes from (18.6), as the answer's `ETag`: guarded or not,
    // since a guarded `GET` is fed once its rungs admit the follower (18.8), and this answer passed
    // them already.
    const etag = serving !== undefined ? `"${versionOf(serving)}"` : undefined
    if (etag !== undefined) {
        headers.set(VERSION_HEADER, etag)
        for (const followers of RPC_SERVER.following)
            followers.served(found.handler, serving, invoked.key as string)
    }
    // 21.22 — A `GET` THE DEVICE KEEPS, where the worker is there to keep it: a value, not a
    // refusal (16.40) nor a stream with no end to keep (16.32) — a generator's, or the lines a
    // `response.jsonl` or a `response.sse` fixed.
    const framing = currentRequestScope()?.framing
    const kept =
        offline &&
        found.method === 'GET' &&
        !isFailed(value) &&
        !isValues(value) &&
        framing !== 'jsonl' &&
        framing !== 'sse' &&
        writtenStatus() < 300
    // 21.8, 21.9, 21.11 — WHAT IS LEFT OF THE LIFE OF THE PRODUCTION ANSWERED, in place of
    // `no-store` or ahead of 21.22's directives, and nothing else. 21.17 — a `ttl` of Infinity is
    // bounded by `invalidate` alone (11.35), which no cache downstream hears, so it keeps the default.
    const life = Number.isFinite(deadline)
        ? `, max-age=${Math.max(0, Math.floor((deadline - Date.now()) / 1000))}`
        : ''
    if (life !== '' || kept)
        headers.set(
            'cache-control',
            `private${life}${kept ? `, ${OFFLINE_STALE}` : ''}`,
        )
    // 18.19 — A READER HOLDING THIS VERSION IS TOLD SO, and sent no body.
    if (
        etag !== undefined &&
        namesEtag(request.headers.get('if-none-match'), etag)
    )
        return new Response(null, { status: 304, headers })
    // 18.20 — A READER ASKING FOR AN EVENT STREAM IS FOLLOWED, rather than answered once: the value,
    // then each change, from the version its `Last-Event-ID` names. A handler that streams answers
    // its own chunks as it always has (16.45).
    const followers = currentRequestScope()?.app?.followers
    if (
        etag !== undefined &&
        followers !== undefined &&
        !isValues(outcome.value) &&
        prefers(request, 'text/event-stream', 'application/json')
    ) {
        const events = handlerHeaders()
        sseHeaders(events)
        return new Response(
            followers.events(
                found,
                invoked.args,
                versionInEtag(request.headers.get('last-event-id')),
            ),
            { status: 200, headers: events },
        )
    }
    // 16.40 FOR A STREAM TOO. A stream's head waits on its first chunk, so one refusing before it
    // said anything throws out of the answer rather than settling into the outcome — and was answered
    // 500, as a throw that is not a `Failed` is (16.41), where the refusal named its own status. Any
    // other throw goes on to where it went before.
    try {
        return await answerValue(
            outcome.value,
            request,
            headers,
            writtenStatus(),
        )
    } catch (error) {
        if (isFailed(error)) return answered(error)
        throw error
    }
}

async function argsOf(
    request: Request,
    url: URL,
    inUrl: boolean,
    form: boolean,
    maxBodySize: number | undefined,
): Promise<unknown | Failed<'HttpError', undefined>> {
    if (inUrl) {
        const query = url.searchParams
        if (query.size === 0) return undefined
        return collapsed(query)
    }
    const body = await bodyWithin(request, maxBodySize)
    if (isFailed(body)) return body
    // 16.38 — a form's fields, a field given more than once a list, as a query's are.
    if (form) {
        return collapsed(await body.formData())
    }
    const text = await body.text()
    if (text === '') return undefined
    // 16.20 — a body that is not an `Args` is the caller's fault.
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return refuse(400, 'The request body is not JSON.')
    }
    if (!isRecord(parsed))
        return refuse(400, 'The request body is not an object of args.')
    return parsed
}

/**
 * The request's body, received whole, under the ceiling `maxBodySize` sets, or
 * `ABIDE_MAX_REQUEST_BODY_SIZE` where it is unset, or a 413 refusal past it.
 *
 * 16.54 — NO CEILING BY DEFAULT. 16.55 — read off the declared length before a byte of the body is.
 * 16.78 — EVERY BODY ABIDE READS, a handler's and `/__abide/mcp`'s and `/__abide/bridge`'s alike.
 * 16.23 — and the request received whole once it is read, which is where its idle timeout goes off.
 */
export async function bodyWithin(
    request: Request,
    maxBodySize: number | undefined,
): Promise<Response | Failed<'HttpError', undefined>> {
    const ceiling =
        maxBodySize ??
        positiveSetting('ABIDE_MAX_REQUEST_BODY_SIZE', Number.POSITIVE_INFINITY)
    if (Number(request.headers.get('content-length') ?? 0) > ceiling)
        return overCeiling(ceiling)
    const body = await bodyUnder(request, ceiling)
    if (!isFailed(body)) unreap(currentRequestScope())
    return body
}

/**
 * The request's body read up to `ceiling`, as a `Response`, or a 413 refusal past it.
 *
 * 16.55 — A BODY WITH NO DECLARED LENGTH, BOUNDED AS IT STREAMS: counted chunk by chunk and cut
 * off at the chunk that passes the ceiling, so a caller that never said how much it would send is
 * never held past it. What it read is handed back as a `Response` for the parse to read as it
 * would the request.
 */
async function bodyUnder(
    request: Request,
    ceiling: number,
): Promise<Response | Failed<'HttpError', undefined>> {
    if (!Number.isFinite(ceiling))
        // A blob, which a `Response` shares where it copies an `ArrayBuffer`.
        return new Response(await request.blob(), {
            headers: request.headers,
        })
    const chunks: Uint8Array[] = []
    let size = 0
    if (request.body !== null)
        for await (const chunk of request.body) {
            size += chunk.byteLength
            // Leaving the loop cancels the stream, so the rest is never read.
            if (size > ceiling) return overCeiling(ceiling)
            chunks.push(chunk)
        }
    return new Response(Bun.concatArrayBuffers(chunks), {
        headers: request.headers,
    })
}

function overCeiling(ceiling: number): Failed<'HttpError', undefined> {
    return refuse(413, `The request body is over ${ceiling} bytes.`)
}

function preflight(found: Mounted, origin: string, request: Request): Response {
    const headers = new Headers({
        'access-control-allow-origin': origin,
        'access-control-allow-methods': found.method,
        'access-control-max-age': '600',
        vary: 'origin',
    })
    const asked = request.headers.get('access-control-request-headers')
    if (asked !== null) headers.set('access-control-allow-headers', asked)
    return new Response(null, { status: 204, headers })
}

function isForm(request: Request): boolean {
    const type = request.headers.get('content-type') ?? ''
    return (
        type.startsWith('application/x-www-form-urlencoded') ||
        type.startsWith('multipart/form-data')
    )
}

/**
 * The answer a form posted with no script gets.
 *
 * 16.38 — a `response.redirect` the handler wrote passes through; a value is a 303 back where the form was;
 * a refusal renders the nearest error page at its own status, and a fault renders it at 500.
 */
async function navigated(
    outcome: Outcome,
    request: Request,
    pathname: string,
    pages: ErrorPages,
): Promise<Response> {
    if (!outcome.settled)
        return answerFailure(pages, pathname, failureOf(outcome.error), request)
    if (isFailed(outcome.value))
        return answerFailure(pages, pathname, outcome.value, request)
    const headers = new Headers({ 'cache-control': 'private, no-store' })
    const written = currentRequestScope()?.response
    const status = written?.status ?? 200
    if (
        status >= 300 &&
        status < 400 &&
        written?.headers.has('location') === true
    )
        return new Response(null, { status, headers })
    // 16.53 — back where the form was only where that is this app: a `Referer` naming another
    // origin makes the 303 an open redirect.
    const referer = request.headers.get('referer')
    const from = referer === null ? null : URL.parse(referer)
    headers.set(
        'location',
        from !== null && from.origin === ownOrigin(request.url)
            ? from.href
            : underMount('/'),
    )
    return new Response(null, { status: 303, headers })
}
