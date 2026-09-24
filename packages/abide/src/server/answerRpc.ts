// 16.2 — A HANDLER, ANSWERED OVER HTTP. The call is the in-process one (`#shared/rpc.ts`), made in a
// request's own scope (11.32), and what this module adds is the transport either side of it: the
// args off the request, and the answer onto a response.
//
// WIRE-ONLY, per 16.14: the `Origin` gate on a mutation, `maxBodySize`, the `crossOrigin` preflight,
// raising the request's idle timeout (16.23), and 19.8's coercion of the text a URL carried.

import {
    argsDocumentOf,
    coerceArgs,
    type Document,
} from '#shared/coerceArgs.ts'
import { type Failed, isFailed, wireFailure } from '#shared/Failed.ts'
import { isRecord } from '#shared/isRecord.ts'
import { mounted as underMount } from '#shared/mount.ts'
import type { Gated } from '#shared/reactive/Keyed.ts'
import { notFound, refuse } from '#shared/refuse.ts'
import type { Method, Rpc } from '#shared/rpc.ts'
import { argsInURL } from '#shared/rpcRequest.ts'
import type { Socket } from '#shared/socket.ts'
import { answerValue } from './answerValue.ts'
import { callerOf } from './callerOf.ts'
import { appOrigin, positiveSetting } from './config.ts'
import { failureOf } from './hooks.ts'
import { prefers } from './prefers.ts'
import {
    currentRequestScope,
    LISTENING,
    writtenStatus,
} from './requestScope.ts'
import { type Outcome, outcomeOf, takeSeed } from './seedBuffer.ts'

// One row of the table the build writes to `<out>/rpc.ts`: where a handler answers, and where its
// module is — relative to the app's root, which both commands that serve already know. 18.2 — a
// socket is a row too, whose method is `SOCKET`.
export type Mount = {
    address: string
    method: Method | 'SOCKET'
    source: string
    name: string
    // 20.4 — whether a browser is handed a wrapper for it.
    ui: boolean
}

export type Mounted = Mount & {
    method: Method
    handler: Rpc<unknown, unknown>
    // 19.8, 20.11 — the args' JSON Schema, probed once at mount: a third-party schema converts
    // itself on every probe.
    argsDocument: Document | undefined
}

// 16.14 — the ceiling on a mutation's body where neither the handler nor the environment names one.
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024
// 16.23 — how long a call may go without progress where neither names one.
const DEFAULT_TIMEOUT_MS = 30_000

// The table, as addresses to what answers them — imported from the SOURCE tree, so a page rendering
// on the server and a call over the wire reach one module and so one handler. AT BOOT rather than
// on the first call, because a page's render reaches a handler through the page's own import and
// has to know its address before anything has called it over the wire. One pass over both kinds of
// row, split by method into what `answerRpc` and the socket mux each answer from.
export async function mountHandlers(
    table: Mount[],
    root: string,
): Promise<{
    handlers: Map<string, Mounted>
    sockets: Map<string, Socket<unknown, unknown>>
}> {
    const modules = await Promise.all(
        table.map(
            (mount) =>
                import(
                    Bun.pathToFileURL(`${root}/${mount.source}`).href
                ) as Promise<Record<string, unknown>>,
        ),
    )
    const handlers = new Map<string, Mounted>()
    const sockets = new Map<string, Socket<unknown, unknown>>()
    for (let at = 0; at < table.length; at += 1) {
        const mount = table[at] as Mount
        const exported = (modules[at] as Record<string, unknown>)[mount.name]
        if (mount.method === 'SOCKET') {
            const carried = exported as Socket<unknown, unknown>
            carried.address = mount.address
            sockets.set(mount.address, carried)
            continue
        }
        const handler = exported as Rpc<unknown, unknown> & Gated<unknown>
        // 16.10, 16.11 — the address `rpc.url` and `rpc.raw` build on, under the mount — and what a
        // page's render turns a call it made into the browser's request by (41.21).
        handler.address = underMount(mount.address)
        handlers.set(mount.address, {
            ...mount,
            method: mount.method,
            handler,
            argsDocument: argsDocumentOf(handler),
        })
    }
    return { handlers, sockets }
}

export async function answerRpc(
    handlers: Map<string, Mounted>,
    url: URL,
    request: Request,
    // 16.40 — what paints a refusal for a request that came as a navigation.
    failurePage: (failure: Failed<string, unknown>) => Promise<Response>,
): Promise<Response> {
    const pathname = url.pathname
    const found = handlers.get(pathname)
    const origin = request.headers.get('origin')
    // 16.25 — THE PREFLIGHT, answered by abide where the handler declared `crossOrigin`.
    if (
        found !== undefined &&
        request.method === 'OPTIONS' &&
        origin !== null &&
        allows(found.handler.crossOrigin, origin)
    )
        return preflight(found, origin, request)
    // 15.7 — no handler at this address AND this method is one refusal, not two.
    if (found === undefined || found.method !== request.method)
        return answered(notFound({ path: pathname, method: request.method }))
    const handler = found.handler
    const inUrl = argsInURL(found.method)
    const form = isForm(request)
    const crossing = crossingOrigin(origin, url)
    // 16.14 — A MUTATION FROM ANOTHER ORIGIN IS REFUSED unless the handler declared it may come.
    if (crossing !== null && !inUrl && !allows(handler.crossOrigin, crossing))
        return answered(
            refuse(
                403,
                `A ${found.method} from ${crossing} is not allowed here.`,
            ),
        )
    // 16.14 — THE BODY CEILING, read off the declared length before a byte of it is.
    if (!inUrl) {
        const ceiling =
            handler.maxBodySize ??
            positiveSetting(
                'ABIDE_MAX_REQUEST_BODY_SIZE',
                DEFAULT_MAX_BODY_SIZE,
            )
        const declared = Number(request.headers.get('content-length') ?? 0)
        if (declared > ceiling)
            return answered(
                refuse(413, `The request body is over ${ceiling} bytes.`),
            )
    }
    const raw = await argsOf(request, url, inUrl, form)
    if (isFailed(raw)) return answered(raw)
    // 19.8 — the text a URL carried, as the types the handler's `args` declares — and a form's, which
    // is text for the same reason.
    const args =
        inUrl || form
            ? coerceArgs(
                  raw as Record<string, string | string[]> | undefined,
                  found.argsDocument,
              )
            : raw
    raiseTimeout(
        request,
        handler.timeout ??
            positiveSetting('ABIDE_RPC_TIMEOUT', DEFAULT_TIMEOUT_MS),
    )
    // 41.7 — the call a hydrating page makes for what its render already reached is answered from
    // that, and the handler is not run again (41.13).
    const caller = callerOf()
    const seeded =
        caller === undefined ? undefined : takeSeed(caller, handler, args)
    const started = performance.now()
    const outcome =
        seeded === undefined ? await outcomeOf(handler(args)) : await seeded
    // 16.40 — A MUTATION A DOCUMENT MADE — a form posted with no script — is answered as a navigation.
    if (!inUrl && prefers(request, 'text/html', 'application/json'))
        return navigated(outcome, request, failurePage)
    const answer = await answerOutcome(outcome, request)
    // A `Response` the handler built is its own.
    if (outcome.settled && outcome.value instanceof Response)
        return stamped(answer, crossing, undefined, false)
    // A stream's time is to its first chunk, which the answer's head waited for.
    return stamped(
        answer,
        crossing,
        outcome.duration ?? performance.now() - started,
        seeded !== undefined,
    )
}

// 21.7 — the origin a crossing call came from; 21.15 — HOW LONG THE HANDLER TOOK, AND WHICH RUN THIS
// IS, for the network panel: an answer from the render's run looks exactly like a fresh one
// otherwise, and the time is the handler's own rather than this request's.
function stamped(
    answer: Response,
    crossing: string | null,
    duration: number | undefined,
    seeded: boolean,
): Response {
    if (crossing !== null) allowOrigin(answer, crossing)
    if (duration !== undefined)
        answer.headers.set(
            'server-timing',
            seeded
                ? `handler;dur=${duration.toFixed(1)};desc="answered from the render's run"`
                : `handler;dur=${duration.toFixed(1)}`,
        )
    return answer
}

async function answerOutcome(
    outcome: Outcome,
    request: Request,
): Promise<Response> {
    if (!outcome.settled) return answered(failureOf(outcome.error))
    // 21.3 — what the handler wrote through `response` is laid over it at the exit (21.10).
    return answerValue(
        outcome.value,
        request,
        defaultHeaders(),
        writtenStatus(),
    )
}

function defaultHeaders(): Headers {
    return new Headers({
        'content-type': 'application/json',
        'cache-control': 'private, no-store',
    })
}

// 15.1 — a refusal crosses the wire as the four fields it is, at its own status.
function answered(failure: Failed<string, unknown>): Response {
    return new Response(JSON.stringify(wireFailure(failure)), {
        status: failure.status,
        headers: defaultHeaders(),
    })
}

// 16.19's first half: a `GET` or `DELETE` carries its args in the URL and a mutation in the body.
// A query member given more than once is a list; one given once is its text (19.8 is the coercion).
function collapsed(
    entries: URLSearchParams | FormData,
): Record<string, unknown> {
    const args: Record<string, unknown> = {}
    for (const name of new Set(entries.keys())) {
        const values = entries.getAll(name)
        args[name] = values.length === 1 ? values[0] : values
    }
    return args
}

async function argsOf(
    request: Request,
    url: URL,
    inUrl: boolean,
    form: boolean,
): Promise<unknown | Failed<'HttpError', undefined>> {
    if (inUrl) {
        const query = url.searchParams
        if (query.size === 0) return undefined
        return collapsed(query)
    }
    // 16.40 — a form's fields, a field given more than once a list, as a query's are.
    if (form) {
        return collapsed(await request.formData())
    }
    const text = await request.text()
    if (text === '') return undefined
    // 16.21 — a body that is not an `Args` is the caller's fault.
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

// 36.2 — the `Origin` a request came from when it is not the app's own, and `null` when it is: the
// app's own is `APP_URL`'s where the app declares one, and the request's where not.
export function crossingOrigin(
    origin: string | null,
    url: URL | string,
): string | null {
    if (origin === null) return null
    const own =
        appOrigin() ?? (typeof url === 'string' ? new URL(url) : url).origin
    return origin === own ? null : origin
}

export function allows(
    crossOrigin: boolean | string[],
    origin: string,
): boolean {
    return (
        crossOrigin === true ||
        (Array.isArray(crossOrigin) && crossOrigin.includes(origin))
    )
}

// 21.7 — the answer depends on `Origin`, and says so.
function allowOrigin(answer: Response, origin: string): void {
    answer.headers.set('access-control-allow-origin', origin)
    answer.headers.append('vary', 'origin')
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

// 16.23, 16.24 — THE REQUEST'S IDLE TIMEOUT, RAISED AND NEVER LOWERED: the floor is the longest any
// handler in the request asked for. Where no socket is bound there is no idle timeout to raise.
function raiseTimeout(request: Request, milliseconds: number): void {
    const scope = currentRequestScope()
    const bound = LISTENING.server
    if (scope === undefined || bound === undefined) return
    const seconds = Math.min(255, Math.ceil(milliseconds / 1000))
    if (seconds <= scope.timeout) return
    scope.timeout = seconds
    bound.timeout(request, seconds)
}

function isForm(request: Request): boolean {
    const type = request.headers.get('content-type') ?? ''
    return (
        type.startsWith('application/x-www-form-urlencoded') ||
        type.startsWith('multipart/form-data')
    )
}

// 16.40 — THE ANSWER A FORM GETS: a `redirect` the handler wrote passes through; a value is a 303
// back where the form was; a refusal renders the nearest error page at its own status, and a fault
// renders it at 500.
async function navigated(
    outcome: Outcome,
    request: Request,
    failurePage: (failure: Failed<string, unknown>) => Promise<Response>,
): Promise<Response> {
    if (!outcome.settled) return failurePage(failureOf(outcome.error))
    if (isFailed(outcome.value)) return failurePage(outcome.value)
    const headers = new Headers({ 'cache-control': 'private, no-store' })
    const written = currentRequestScope()?.response
    const status = written?.status ?? 200
    if (
        status >= 300 &&
        status < 400 &&
        written?.headers.has('location') === true
    )
        return new Response(null, { status, headers })
    headers.set('location', request.headers.get('referer') ?? '/')
    return new Response(null, { status: 303, headers })
}
