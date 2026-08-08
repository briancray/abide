// The shapes an app's OWN route answers with, and the one it throws.
//
// abide serves `/__abide/**` through `dispatch`; every other path is the app's, and a route there
// hands back an ordinary `Response`. So does each of these — nothing here is a framework object a
// caller has to unwrap, which is what lets a handler that outgrows them drop to `new Response(...)`
// and lose nothing.
//
// `error` is the exception: it THROWS, because an rpc handler's return type is its value and a
// refusal has to leave by a door the value does not use. What a handler WRITES is still `return` —
// `return error(404)` and `return notFound({ id })` are the same statement, and the throw is this
// file's business rather than the caller's.
//
// The two differ only in what the return type is left holding. A bare `error` is declared `never`,
// which vanishes from the union — nothing to name, so nothing to carry — and that is also what lets
// a bare call stand as a guard, with the checker treating the line after it as unreachable. A
// `error.typed` failure with a declared shape returns `Failed<Name, Data>` instead, so the name and
// the payload land in the handler's own type and a caller narrows to them.

import { isThenable } from '$shared/internal/probes.ts'
import {
    errorFrame,
    type Failed,
    type FailureOptions,
    framedBody,
    HttpError,
    JSON_TYPE,
    JSONL_TYPE,
    jsonLine,
} from '$shared/internal/wire.ts'
import { gate, type Schema } from './schema.ts'
import { pendingCookies, traceResponse } from './scopes.ts'

export type { Failed, FailureOptions } from '$shared/internal/wire.ts'
// The class itself lives on the wire seam, because the browser lane builds one too: `wireError`
// rebuilds a refusal as exactly this, so a caught failure has the same four members on both sides.
export { HttpError } from '$shared/internal/wire.ts'

const SSE_TYPE = 'text/event-stream'
const HTML_TYPE = 'text/html; charset=utf-8'

type Values<T> = AsyncIterable<T> | Iterable<T>

/**
 * The caller's headers, plus whatever this shape needs and the caller did not say.
 *
 * `has` rather than an overwrite: a route that sets its own `content-type` — a JSON dialect, a
 * charset — means it, and a helper that clobbered it would be a helper nobody could use twice.
 *
 * Takes the headers rather than the whole `ResponseInit`, so the rpc wire in `rpc.ts` — which has a
 * bare header map and no init at all — merges through this one rather than a second copy of it.
 */
export function headersFor(carried: HeadersInit | undefined, defaults: Record<string, string>): Headers {
    const headers = new Headers(carried)
    for (const name in defaults) {
        if (!headers.has(name)) headers.set(name, defaults[name] as string)
    }
    // Every response abide builds says which operation answered it — this helper is the one funnel
    // all of them go through, including the rpc wire and every refusal `dispatch` writes. A failure
    // is the response you most want to correlate, so the 404 carries it too.
    //
    // `has` first, like the defaults above: a caller that set its own means it.
    if (!headers.has('traceresponse')) {
        const parent = traceResponse()
        if (parent !== null) headers.set('traceresponse', parent)
    }
    // A login is a call deep inside a handler and the response is built somewhere else entirely, so
    // the cookie rides the same funnel. `append`, not `set`: `Set-Cookie` is the one header that may
    // legitimately appear more than once, and a caller that wrote its own keeps it.
    const cookies = pendingCookies()
    if (cookies !== null) {
        for (let i = 0; i < cookies.length; i++) headers.append('set-cookie', cookies[i] as string)
    }
    return headers
}

/**
 * A value as JSON.
 *
 * `data ?? null` because `undefined` is not JSON: a handler that returned nothing would otherwise
 * produce a body of the literal text `undefined`, which no decoder on the other side accepts.
 */
export function json(data: unknown, init?: ResponseInit): Response {
    return new Response(JSON.stringify(data ?? null), {
        ...init,
        headers: headersFor(init?.headers, { 'content-type': JSON_TYPE }),
    })
}

/** A sequence as one JSON value per line, written as the consumer asks for it. */
export function jsonl<T>(values: Values<T>, init?: ResponseInit): Response {
    return new Response(framedBody(values, jsonLine), {
        ...init,
        headers: headersFor(init?.headers, { 'content-type': JSONL_TYPE }),
    })
}

/**
 * The same machine as `jsonl`, framed as server-sent events.
 *
 * One `data:` line per value, because JSON has no unescaped newline and an event's payload is
 * delimited by one. The two extra headers are what stops the stream being held: `no-cache` for the
 * browser, `x-accel-buffering` for the reverse proxies that buffer a response until it ends — an SSE
 * stream that arrives all at once at the end is not a stream.
 */
export function sse<T>(values: Values<T>, init?: ResponseInit): Response {
    return new Response(framedBody(values, sseFrame), {
        ...init,
        headers: headersFor(init?.headers, {
            'content-type': SSE_TYPE,
            'cache-control': 'no-cache',
            'x-accel-buffering': 'no',
        }),
    })
}

function sseFrame(value: unknown): string {
    return `data: ${JSON.stringify(value)}\n\n`
}

/**
 * A rendered document as a response.
 *
 * Takes what a render PRODUCED rather than doing the render, so one helper serves `renderToString`, `toStream`
 * and `renderDocument` without restating any of their options — and so this file keeps importing
 * nothing from the walk.
 *
 * It exists because a page render is the one response abide could not reach: the other helpers here
 * build a `Response` and this had no equivalent, so a document was the only thing an app served that
 * carried no `traceresponse`. A hole in the correlation is a hole in exactly the request a user is
 * complaining about.
 */
export function page(body: string | ReadableStream<Uint8Array>, init?: ResponseInit): Response {
    return new Response(body, {
        ...init,
        headers: headersFor(init?.headers, { 'content-type': HTML_TYPE }),
    })
}

// --- navigate ----------------------------------------------------------------

/** The only statuses that mean "look over there". Anything else is a typo the checker can catch. */
export type RedirectStatus = 301 | 302 | 303 | 307 | 308

/**
 * Go there instead.
 *
 * Two things over `Response.redirect`: the status is a TYPE here rather than a `RangeError` at
 * runtime, and there is an `init` at all — the redirect every login ends with also sets a cookie,
 * and `Response.redirect` takes no headers.
 */
export function redirect(to: string, status: RedirectStatus = 302, init?: ResponseInit): Response {
    return new Response(null, { ...init, status, headers: headersFor(init?.headers, { location: to }) })
}

// --- fail --------------------------------------------------------------------

/** A named failure, as many times as an app needs it. Carries its own `kind` so no caller retypes it. */
export interface Failure<Name extends string = string> {
    (message?: string, options?: FailureOptions): never
    readonly kind: Name
    readonly status: number
    /** The phrase the declaration settled on, which a bare call throws. */
    readonly message: string
}

/**
 * The same, DECLARED to carry something: `myError({ id })` rather than `myError('no user 9')`.
 *
 * It RETURNS rather than being `never`, and that is the whole of how the shape reaches the caller:
 * `return myError({ id })` puts `Failed<'MyError', Data>` in the handler's return type, the stub's
 * type is the handler's, and `fn(args).isError(e, 'MyError')` narrows `e.data` off it. It still
 * throws — the return type is what the checker reads, not what the call does — so `throw myError(…)`
 * is the same refusal and only loses the caller's ability to name it.
 *
 * The message moved to the DECLARATION because the first argument is the data now; it is still
 * overridable per throw, in the position it was always optional in.
 */
export interface DataFailure<Name extends string, Data> {
    (data: Data, message?: string, options?: ErrorOptions): Failed<Name, Data>
    readonly kind: Name
    readonly status: number
    readonly message: string
}

/** What a declaration says its failure CARRIES. The one option, so there is one reason to pass a bag. */
export interface TypedOptions<Data> {
    /**
     * The shape of the data, in any of the three forms `rpc` takes — and the thing that makes this
     * failure a carrying one at all, in the types and at runtime alike.
     */
    schema: Schema<Data>
}

/**
 * Fail this call.
 *
 * The STATUS first, and the only argument there is no answering without: it is what the caller acts
 * on and what everything downstream reads — `respond` maps it, `onError` skips what carries one, a
 * proxy in front logs it. The MESSAGE is the part a status may already have said, so `error(404)` is
 * a whole refusal and `error(404, 'no user for that token')` is the same guard with more to add.
 *
 * `never`, so a call reads as a statement and the checker knows the line after it is unreachable — a
 * guard, not a value someone has to remember to `throw`. All three spellings are the same refusal:
 * `error(404)` as a guard, `return error(404)` beside a handler's other returns, and `throw
 * error(404)`. `never` is assignable to anything and disappears from a union, so the returned form
 * costs the handler's type nothing — a status has no name to narrow to, which is the whole reason
 * `error.typed` exists.
 */
export function error(status: number, message?: string, options?: FailureOptions): never {
    throw new HttpError('HttpError', message ?? phraseFor(status), status, options)
}

// Two call shapes, and the SCHEMA is what chooses between them — in the types and at runtime alike,
// which is the only reason there is one rule to remember rather than two.
interface Typed {
    <Name extends string>(kind: Name, status?: number, message?: string): Failure<Name>
    <Name extends string, Data>(
        kind: Name,
        status: number | undefined,
        message: string | undefined,
        options: TypedOptions<Data>,
    ): DataFailure<Name, Data>
}

/**
 * A reusable failure with a NAME on it, and optionally with a declared SHAPE:
 *
 *   const notFound = error.typed('NotFound', 404)
 *   const declined = error.typed('Declined', 422, 'that card was declined', { schema })
 *
 * The name is the whole point of declaring one. An error that crossed a wire arrives as a plain
 * object, so `instanceof` on it is false however faithfully it was serialised — `isError(e, 'NotFound')`
 * is the question that survives the trip, and it asks about the name this puts there.
 *
 * The status and the message are declared ONCE here, which is what makes a bare `notFound()` whole:
 * the phrase a status already says is resolved at the DECLARATION rather than looked up on every
 * throw, and 500 is the status of a failure nobody classified — a fault is ours until an app says
 * whose it is.
 *
 * A declared `schema` moves the message along one place and puts the DATA first, because a failure
 * that carries something is one a caller acts on rather than reads. `Data` comes off the schema, so
 * the shape is written once; a raw JSON Schema types nothing on its own — it answers "does this
 * match" and not "what is it" — and either takes both type arguments or the plain-function form.
 */
error.typed = ((kind: string, status = 500, message?: string, options?: TypedOptions<unknown>): Failure => {
    const phrase = message ?? phraseFor(status)
    // Built once, at the declaration, exactly like an endpoint's — and `null` is the whole cost of
    // this to a failure that declares no shape.
    const check = gate(options?.schema, 'data', 500, { address: kind })
    const failure = (
        check === null
            ? (text?: string, held?: FailureOptions): never => {
                  throw new HttpError(kind, text ?? phrase, status, held)
              }
            : (data: unknown, text?: string, held?: ErrorOptions): never => {
                  const checked = check(data)
                  // A `throw` has nowhere to put a promise, which is why the plain-function form of a
                  // schema is synchronous by contract. A library one that answers with a promise is a
                  // declaration this position cannot serve, and saying so beats carrying the promise.
                  if (isThenable(checked)) {
                      throw new Error(`abide: ${kind} — a failure's shape must check synchronously`)
                  }
                  throw new HttpError(kind, text ?? phrase, status, {
                      cause: held?.cause,
                      data: checked,
                  })
              }
    ) as Failure
    Object.defineProperty(failure, 'kind', { value: kind, enumerable: true })
    Object.defineProperty(failure, 'status', { value: status, enumerable: true })
    Object.defineProperty(failure, 'message', { value: phrase, enumerable: true })
    return failure
}) as Typed

/**
 * What a status already says, so an unsaid message is never an empty one.
 *
 * The registry's phrases verbatim rather than wording of abide's own: a caller reading `Not Found`
 * off the wire is reading what that number has meant since HTTP/1.0, and a framework that improved
 * on it would be one whose 404s do not match anybody else's. `Response.statusText` is where the
 * platform keeps this, and it is empty for a status nobody spelled out — Bun answers `''` for every
 * one of these — so the table is here.
 *
 * ALL of 4xx and 5xx, because a partial one is two rules: `error(422)` naming itself while
 * `error(423)` did not is a gap only found by shipping it. Nothing below 400, and a status outside
 * the range says what it knows and no more.
 */
function phraseFor(status: number): string {
    return STATUS_PHRASES[status] ?? `HTTP ${status}`
}

const STATUS_PHRASES: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Content Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Range Not Satisfiable',
    417: 'Expectation Failed',
    421: 'Misdirected Request',
    422: 'Unprocessable Content',
    423: 'Locked',
    424: 'Failed Dependency',
    425: 'Too Early',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    508: 'Loop Detected',
    510: 'Not Extended',
    511: 'Network Authentication Required',
}

/**
 * The other direction: a failure as a RESPONSE, in the one shape a caller decodes.
 *
 * `error` throws and this writes, which is why they are two functions and not one — a handler refuses
 * by throwing because its return type is its value, and something further out has to turn that into
 * bytes. Here rather than beside either caller: `rpc.ts` answers a call with it and `lifecycle.ts`
 * answers an app ROUTE with it, and the wire shape of a failure must not be decided by whichever of
 * the two happened to declare it.
 *
 * Takes the NAME and the message rather than an `Error`, because the gate in `registry.ts` refuses
 * with neither in hand — building one there only to read two fields back off it captures a stack per
 * 404, and `errorPayload` throws the rest away. `data` is what a DECLARED failure carries, and it is
 * last because the refusals that pass neither it nor the headers are most of them.
 */
export function failed(
    name: string,
    message: string,
    status: number,
    extra?: Record<string, string>,
    data?: unknown,
): Response {
    return new Response(JSON.stringify(errorFrame(name, message, data)), {
        status,
        headers: headersFor(extra, { 'content-type': JSON_TYPE }),
    })
}
