// 16.2 — A HANDLER, ANSWERED OVER HTTP. The call is the in-process one (`#shared/rpc.ts`), made in a
// request's own scope (11.32), and what this module adds is the transport either side of it: the
// args off the request, and the answer onto a response.
//
// WIRE-ONLY, per 16.13: the `Origin` gate on a mutation, `maxBodySize`, the `crossOrigin` preflight,
// raising the request's idle timeout (16.22), and 19.7's coercion of the text a URL carried.

import type { CopyOptions } from '#shared/CopyOptions.ts'
import { type Failed, isFailed } from '#shared/Failed.ts'
import { GLOBAL_GETS } from '#shared/GLOBAL_GETS.ts'
import { isRecord } from '#shared/isRecord.ts'
import type { JsonValue } from '#shared/JsonValue.ts'
import { mounted as underMount } from '#shared/mount.ts'
import { RPC_SERVER } from '#shared/RPC_SERVER.ts'
import type { Gated } from '#shared/reactive/argsContract.ts'
import { deadlineOf, heldGenerationOf } from '#shared/reactive/index.ts'
import type { Defaults } from '#shared/reactive/parameterDefaults.ts'
import { notFound, refuse } from '#shared/refuse.ts'
import type { Method, Rpc } from '#shared/rpc.ts'
import { argsInURL } from '#shared/rpcRequest.ts'
import { VERSION_HEADER } from '#shared/VERSION_HEADER.ts'
import { versionInEtag } from '#shared/versionInEtag.ts'
import {
    answered,
    answerFailure,
    type ErrorPages,
    handlerHeaders,
} from './answerFailure.ts'
import { followAsEvents } from './answerSocket.ts'
import { answerValue, namesEtag, sseHeaders } from './answerValue.ts'
import { argsFor } from './argsFor.ts'
import { callerOf } from './callerOf.ts'
import { argsDocumentOf, collapsed, type Document } from './coerceArgs.ts'
import { positiveSetting } from './config.ts'
import {
    allows,
    closedTo,
    crossingOrigin,
    crossingRefusal,
} from './crossingOrigin.ts'
import { failureOf } from './hooks.ts'
import { prefers } from './prefers.ts'
import {
    currentRequestScope,
    LISTENING,
    rungsTook,
    timed,
    writtenStatus,
} from './requestScope.ts'
import { type Outcome, outcomeOf, takeSeed } from './seedBuffer.ts'
import { versionOf } from './versionOf.ts'

/**
 * One row of the table the build writes to `<out>/rpc.ts`: where a handler answers, and its module.
 *
 * The module is relative to the app's root, which both commands that serve already know.
 */
export type Mount = {
    address: string
    method: Method
    source: string
    name: string
    /** Whether a browser is handed a wrapper for it. 20.4. */
    ui: boolean
    /** Whether the command line lists it — the shell's listing and completion, never whether `call` reaches it. 20.3, 38.63. */
    cli: boolean
    /**
     * Whether MCP lists it where its runtime `clients` does not say.
     *
     * 16.37 — false for a handler typed as returning a `Response`, which only the build can tell.
     */
    mcp: boolean
    /** Its `description`, where the declaration writes one as a literal the build can read. */
    description: string | undefined
    /**
     * What a `GET`'s value declares that the browser's copy behaves by, or `undefined`.
     *
     * 18.4 — set where its declaration names any of it.
     */
    copy: CopyOptions | undefined
    /**
     * The defaults the handler's parameter writes, for the browser's copy to key by.
     *
     * 11.29 — the server reads its own off the handler.
     */
    defaults: Defaults | undefined
    /** The JSON Schema the handler's args annotation derives, where it takes a record. 19.9. */
    args: JsonValue | undefined
}

/** A handler's row, mounted: the handler imported and its args schema probed. */
export type Mounted = Mount & {
    method: Method
    handler: Rpc<unknown, unknown> & Gated<unknown>
    /**
     * The args' JSON Schema, probed once at mount.
     *
     * 19.7, 20.11 — a third-party schema converts itself on every probe.
     */
    argsDocument: Document | undefined
    /**
     * What the wire holds args to where the handler declares no `args` gate of its own.
     *
     * 19.9 — the annotation's schema. An in-process call already holds the type, so the handler
     * never runs it.
     */
    wireArgs: JsonValue | undefined
}

/**
 * The row of a handler abide mounts itself, keyed as `answerRpc` looks one up.
 *
 * Built on the core's `declare` with no generated surface (20.1) — the app's tree never names it.
 */
export function mountedOwn(
    address: string,
    name: string,
    handler: object,
): [string, Mounted] {
    // 16.10 — READ WHEN IT IS REPORTED, where a mounted handler's is stamped at boot: the mount is
    // the configuration's, and nothing boots this handler.
    Object.defineProperty(handler, 'address', {
        get: () => underMount(address),
    })
    return [
        address,
        {
            address,
            method: 'GET',
            source: '',
            name,
            ui: false,
            cli: false,
            mcp: false,
            description: undefined,
            copy: undefined,
            defaults: undefined,
            args: undefined,
            handler: handler as Mounted['handler'],
            argsDocument: undefined,
            wireArgs: undefined,
        },
    ]
}

// 16.58 — the environment's `timeout`, for every call a handler that names none makes.
export function environmentTimeout(): number | undefined {
    return positiveSetting('ABIDE_RPC_TIMEOUT', undefined)
}

/**
 * The table's handlers, imported and keyed by address.
 *
 * Imported from the SOURCE tree, so a page rendering on the server and a call over the wire reach
 * one module and so one handler. AT BOOT rather than on the first call, because a page's render
 * reaches a handler through the page's own import and has to know its address before anything has
 * called it over the wire.
 */
export async function mountHandlers(
    table: Mount[],
    moduleOf: (source: string) => Promise<Record<string, unknown>>,
): Promise<{ handlers: Map<string, Mounted> }> {
    const modules = await Promise.all(
        table.map((mount) => moduleOf(mount.source)),
    )
    const handlers = new Map<string, Mounted>()
    for (let at = 0; at < table.length; at += 1) {
        const mount = table[at] as Mount
        const exported = (modules[at] as Record<string, unknown>)[mount.name]
        const handler = exported as Rpc<unknown, unknown> & Gated<unknown>
        const declared = argsDocumentOf(handler)
        // 16.9, 16.10 — the address `rpc.url` and `rpc.raw` build on, under the mount — and what a
        // page's render turns a call it made into the browser's request by (41.20).
        handler.address = underMount(mount.address)
        handlers.set(mount.address, {
            ...mount,
            method: mount.method,
            handler,
            argsDocument: declared ?? (mount.args as Document | undefined),
            wireArgs: declared === undefined ? mount.args : undefined,
        })
    }
    return { handlers }
}

/** The `Response` to a handler call made over http. */
export async function answerRpc(
    handlers: Map<string, Mounted>,
    url: URL,
    request: Request,
    // 16.38 — what paints a refusal for a request that came as a navigation.
    pages: ErrorPages,
): Promise<Response> {
    const pathname = url.pathname
    const found = handlers.get(pathname)
    const origin = request.headers.get('origin')
    // 16.24 — THE PREFLIGHT, answered by abide where the handler declared `crossOrigin`.
    if (
        found !== undefined &&
        request.method === 'OPTIONS' &&
        origin !== null &&
        allows(found.handler.crossOrigin, origin)
    )
        return preflight(found, origin, request)
    // 16.50 — a `HEAD` is the `GET`'s answer, which the server sends without its body.
    const head = request.method === 'HEAD'
    // 15.7 — no handler at this address AND this method is one refusal, not two.
    if (found === undefined || found.method !== (head ? 'GET' : request.method))
        return answered(notFound({ path: pathname, method: request.method }))
    const handler = found.handler
    const inUrl = argsInURL(found.method)
    const form = isForm(request)
    const crossing = crossingOrigin(origin, url)
    const closed = closedTo(handler.crossOrigin, crossing)
    // 21.19 — the origin the answer admits, where the handler declared it may read.
    const admitted = closed ? null : crossing
    // 16.13 — A MUTATION FROM ANOTHER ORIGIN IS REFUSED unless the handler declared it may come.
    if (closed && !inUrl)
        return answered(crossingRefusal(crossing, found.method))
    // 16.54 — THE BODY CEILING, none where neither the handler nor the environment names one; 16.55 —
    // read off the declared length before a byte of the body is.
    const ceiling =
        handler.maxBodySize ??
        positiveSetting('ABIDE_MAX_REQUEST_BODY_SIZE', Number.POSITIVE_INFINITY)
    if (!inUrl && Number(request.headers.get('content-length') ?? 0) > ceiling)
        return answered(overCeiling(ceiling))
    const raw = await argsOf(request, url, inUrl, form, ceiling)
    if (isFailed(raw)) return answered(raw)
    let args: unknown
    try {
        // A URL's and a form's args are text, and the query tells a bare name from `name=` (19.7).
        args = argsFor(found, raw, inUrl ? url.search : form ? '' : undefined)
    } catch (refused) {
        if (isFailed(refused)) return answered(refused)
        throw refused
    }
    // 16.56 — where neither names one, nothing is raised and the server's own idle timeout stands.
    const timeout = handler.timeout ?? RPC_SERVER.timeout()
    if (timeout !== undefined) raiseTimeout(timeout)
    // 41.7 — the call a hydrating page makes for what its render already reached is answered from
    // that, and the handler is not run again (41.13).
    // 16.51 — a `HEAD` leaves the seed for the `GET` it stands in front of.
    const caller = head ? undefined : callerOf()
    const seeded =
        caller === undefined ? undefined : takeSeed(caller, handler, args)
    // 21.15 — A `global` PRODUCTION ALREADY HELD, and not loading, answers without a run: a run
    // this call started moves the generation, and one it joined was loading when it came.
    const held =
        seeded === undefined ? GLOBAL_GETS.get(handler)?.(args) : undefined
    const heldAt = held === undefined ? undefined : heldGenerationOf(held)
    const timing = currentRequestScope()?.timing
    if (timing !== undefined) timing.answering = handler
    const started = performance.now()
    const outcome =
        seeded === undefined ? await outcomeOf(handler(args)) : await seeded
    const cached =
        heldAt !== undefined &&
        GLOBAL_GETS.get(handler)?.(args) === held &&
        heldGenerationOf(held) === heldAt
    // 16.38 — A MUTATION A DOCUMENT MADE — a form posted with no script — is answered as a navigation.
    if (!inUrl && prefers(request, 'text/html', 'application/json'))
        return navigated(outcome, request, pathname, pages)
    const answer = await answerOutcome(outcome, request, found, args)
    // A `Response` the handler built is its own — but the origin answer below is laid over it, so it
    // varies on `Origin` too (21.7), which `handlerHeaders` never reached.
    if (outcome.settled && outcome.value instanceof Response) {
        answer.headers.append('vary', 'origin')
        return admitting(answer, admitted)
    }
    // 21.15 — HOW LONG THE HANDLER TOOK, AND WHICH RUN THIS IS, for the network panel: the row
    // already names the handler, so the metric names the run. A stream's time is to its first
    // chunk, which the answer's head waited for.
    const took = outcome.duration ?? performance.now() - started
    const run =
        seeded !== undefined
            ? 'Seeded'
            : cached
              ? 'Cached'
              : outcome.duration === undefined
                ? 'Started'
                : 'Direct'
    // 21.20 — what the rungs took is theirs, and the handler's own body is what `Direct` reports.
    const handled = run === 'Direct' ? timing?.handled : undefined
    if (handled !== undefined) rungsTook(took - handled)
    timed(timing, run, handled ?? took)
    return admitting(answer, admitted)
}

/** Whether a handler's value is a stream of chunks, which answers as its own framing. */
function streams(value: unknown): boolean {
    return (
        value instanceof ReadableStream ||
        (value !== null &&
            typeof value === 'object' &&
            Symbol.asyncIterator in (value as object))
    )
}

/** The answer with the crossing origin allowed, where the handler admits it. 21.19. */
function admitting(answer: Response, admitted: string | null): Response {
    if (admitted !== null)
        answer.headers.set('access-control-allow-origin', admitted)
    return answer
}

async function answerOutcome(
    outcome: Outcome,
    request: Request,
    found: Mounted,
    args: unknown,
): Promise<Response> {
    const handler = found.handler
    if (!outcome.settled) return answered(failureOf(outcome.error))
    // The `global` value the answer came from, or `undefined` for one built per request. 18.22 — or
    // for one whose production has moved past what is answered: a seeded answer is what the render
    // reached (41.13). 18.23 — or for a binary.
    const global = GLOBAL_GETS.get(handler)?.(args)
    const value = outcome.value
    const serving =
        global !== undefined &&
        !(
            value instanceof Blob ||
            value instanceof ArrayBuffer ||
            ArrayBuffer.isView(value)
        ) &&
        (streams(value) || (global as { peek(): unknown }).peek() === value)
            ? global
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
        RPC_SERVER.served?.(handler, serving)
    }
    // 21.8, 21.9, 21.11 — WHAT IS LEFT OF THE LIFE OF THE PRODUCTION ANSWERED, in place of `no-store`
    // and nothing else. A `ttl` of Infinity is bounded by `invalidate` alone (11.35), which no cache
    // downstream hears, so it keeps `no-store`.
    if (Number.isFinite(deadline))
        headers.set(
            'cache-control',
            `private, max-age=${Math.max(0, Math.floor((deadline - Date.now()) / 1000))}`,
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
    if (
        etag !== undefined &&
        !streams(outcome.value) &&
        prefers(request, 'text/event-stream', 'application/json')
    ) {
        const events = handlerHeaders()
        sseHeaders(events)
        return new Response(
            followAsEvents(
                found,
                args,
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
    ceiling: number,
): Promise<unknown | Failed<'HttpError', undefined>> {
    if (inUrl) {
        const query = url.searchParams
        if (query.size === 0) return undefined
        return collapsed(query)
    }
    const body = Number.isFinite(ceiling)
        ? await bodyUnder(request, ceiling)
        : request
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

/**
 * Raises the request's idle timeout to cover `milliseconds`, never lowering it.
 *
 * 16.22, 16.23 — the floor is the longest any handler in the request asked for. Where no socket is
 * bound there is no idle timeout to raise.
 *
 * 16.57 — `Infinity` is never reaped, which bun spells 0; any finite bound is capped at the 255
 * seconds bun's idle timeout can hold.
 *
 * ON THE REQUEST THE LISTENER RECEIVED, never the one being answered: under a mount, or past a
 * rung that handed `next` its own, that is a copy, and bun's `timeout` does nothing for a request
 * it was not handed itself.
 */
export function raiseTimeout(milliseconds: number): void {
    const scope = currentRequestScope()
    const received = scope?.received
    if (scope === undefined || received === undefined) return
    const seconds = Number.isFinite(milliseconds)
        ? Math.min(255, Math.ceil(milliseconds / 1000))
        : Number.POSITIVE_INFINITY
    if (seconds <= scope.timeout) return
    scope.timeout = seconds
    LISTENING.timeout(received, Number.isFinite(seconds) ? seconds : 0)
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
 * 16.38 — a `redirect` the handler wrote passes through; a value is a 303 back where the form was;
 * a refusal renders the nearest error page at its own status, and a fault renders it at 500.
 */
async function navigated(
    outcome: Outcome,
    request: Request,
    pathname: string,
    pages: ErrorPages,
): Promise<Response> {
    if (!outcome.settled)
        return answerFailure(pages, pathname, failureOf(outcome.error))
    if (isFailed(outcome.value))
        return answerFailure(pages, pathname, outcome.value)
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
        from !== null && crossingOrigin(from.origin, request.url) === null
            ? from.href
            : underMount('/'),
    )
    return new Response(null, { status: 303, headers })
}
