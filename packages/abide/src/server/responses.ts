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

import { isThenable } from '#shared/internal/probes.ts'
import {
    errorFrame,
    type Failed,
    type FailureOptions,
    type Framed,
    HttpError,
    JSON_TYPE,
    JSONL_TYPE,
    jsonLine,
    SSE_TYPE,
    sseFrame,
    TRANSPORT_ERROR,
} from '#shared/internal/wire.ts'
import { PRIVATE_NO_STORE } from './internal/CACHE.ts'
import { ALWAYS_POLICY } from './internal/POLICY.ts'
import { gate, type Schema } from './schema.ts'
import { ambientHeaders, framedOver, heldFrames, heldStream, holdScope } from './scopes.ts'

export type { Failed, FailureOptions } from '#shared/internal/wire.ts'
// The class itself lives on the wire seam, because the browser lane builds one too: `wireError`
// rebuilds a refusal as exactly this, so a caught failure has the same four members on both sides.
export { HttpError } from '#shared/internal/wire.ts'

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
    // Unconditional, like `traceresponse` below and unlike the defaults above: every response abide
    // builds declares its own type, so there is no caller who wants a browser guessing a different
    // one. The guess is the vulnerability — a JSON refusal sniffed as HTML, or an upload served back
    // under a type it was not stored as, is script execution on this origin.
    headers.set('x-content-type-options', 'nosniff')
    // Every response abide builds says which operation answered it — this helper is the one funnel
    // all of them go through, including the rpc wire and every refusal `dispatch` writes. A failure
    // is the response you most want to correlate, so the 404 carries it too. A login is a call deep
    // inside a handler and the response is built somewhere else entirely, so the cookie it wrote
    // rides the same funnel.
    ambientHeaders(headers)
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

/** A framing as DECLARED — the constant `jsonl` and `sse` are each built from, and nothing per call. */
interface FramingSpec {
    /**
     * `unknown` rather than the value's own type, and that is what keeps the call sites cast-free: a
     * writer that takes anything is assignable to one that takes a `T`.
     */
    frame: (value: unknown) => string
    type: string
    /** What this framing sets beyond its type — `sse`'s two, and nothing for `jsonl`. */
    extra: Record<string, string>
}

/**
 * How a framing WRITES — everything `reframed` needs, and nothing that holds a request open.
 *
 * Split from `Framing` so a per-call framing can be COPIED down to it: `rpc.ts` keeps one on the
 * per-declaration policy for the life of the process, and the two members `Framing` adds would pin
 * that one call's generator and its whole request scope there with it.
 */
export interface FramingWritten extends FramingSpec {
    /** The handler's own `init`, so a re-frame keeps its status and its headers. */
    init: ResponseInit | undefined
}

/**
 * What a framed response was built FROM — the source, and how to write it again.
 *
 * A framing helper is TWO answers to two callers, and until this existed only one of them was right.
 * Somebody else's reader wants the response: `application/jsonl` or `text/event-stream`, framed for a
 * client that knows nothing about abide. A caller IN PROCESS — an SSR pass, a test, a page reading
 * its own app — wants the values, because `for await` over the same declaration in a browser hands
 * back chunks. Handed the envelope instead, an ungated `{#for await}` rendered one stray row on the
 * server and `await catalogue()` answered a `Response`.
 *
 * So the rpc lane takes `values` and gives `release` back, and `respond` writes the framing again
 * over the state's own transcript. The response built here is then never read — which is exactly why
 * the hold is out here rather than inside `heldFrames`, and why it is a release rather than a cancel:
 * cancelling would call `return()` on the generator the lane is about to iterate.
 */
export interface Framing extends FramingWritten {
    /**
     * The source, ONCE — `null` to whoever asks second.
     *
     * A generator has one pass and both lanes reach for it, so this is WHOEVER ASKED FIRST rather than
     * an ordering to get right. It has to be: a `ReadableStream` pulls once at construction to fill
     * its queue, so the body built below took a chunk out from under the rpc lane a microtask after
     * the handler returned — three rows went out as `{"id":1}` and `{"id":3}`, in process and on the
     * wire alike, with nothing anywhere reporting a gap.
     */
    take(): Values<unknown> | null
    /** The scope hold the unread body would have given back. */
    release: (() => void) | null
}

const FRAMED = Symbol.for('abide.framed')

/** The framing this response was built with, or `null` for every other response. */
export function framingOf(held: unknown): Framing | null {
    if (!(held instanceof Response)) return null
    return (held as unknown as Record<symbol, Framing | undefined>)[FRAMED] ?? null
}

const JSONL_FRAMING: FramingSpec = { frame: jsonLine, type: JSONL_TYPE, extra: {} }
// `no-cache` for the browser and `x-accel-buffering` for the reverse proxies that hold a response
// until it ends — an SSE stream arriving all at once at the end is not a stream.
const SSE_FRAMING: FramingSpec = {
    frame: sseFrame,
    type: SSE_TYPE,
    extra: { 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
}

/**
 * The response a framing writes, over any source — used to build one and, in `respond`, to write the
 * same one again over the state that took its values.
 *
 * NOT branded here: a re-frame is the body somebody is about to read, and marking it would invite a
 * second lane to take those values too.
 */
export function reframed<T>(framing: FramingWritten, source: Values<T>): Response {
    return new Response(heldFrames(source, framing.frame), {
        ...framing.init,
        headers: headersFor(framing.init?.headers, { 'content-type': framing.type, ...framing.extra }),
    })
}

function framed<T>(spec: FramingSpec, values: Values<T>, init: ResponseInit | undefined): Framed<T> {
    let source: Values<T> | null = values
    const framing: Framing = {
        ...spec,
        init,
        take: () => {
            const held = source
            source = null
            return held
        },
        release: holdScope(),
    }
    // NO READ-AHEAD, which is what makes the claim above a claim: a stream built with a queue pulls
    // once at construction, and that pull ran the handler's generator for one value before the rpc
    // lane had taken anything. See `framedOver` for what this replaced.
    const body = framedOver(values, spec.frame, undefined, framing.release, 0)
    const response = new Response(body, {
        ...init,
        headers: headersFor(init?.headers, { 'content-type': spec.type, ...spec.extra }),
    })
    ;(response as unknown as Record<symbol, Framing>)[FRAMED] = framing
    return response as Framed<T>
}

/** A sequence as one JSON value per line, written as the consumer asks for it. */
export function jsonl<T>(values: Values<T>, init?: ResponseInit): Framed<T> {
    return framed(JSONL_FRAMING, values, init)
}

/** The same machine as `jsonl`, framed as server-sent events. */
export function sse<T>(values: Values<T>, init?: ResponseInit): Framed<T> {
    return framed(SSE_FRAMING, values, init)
}

/**
 * The three things a page body can be, as one stream.
 *
 * The async-iterable arm is what lets `page(render(view))` be written at all: `render` IS the
 * generator, and requiring `page(toStream(view))` made the one composition an app reaches for the one
 * that needed a second import. Framed through `heldFrames` rather than a `ReadableStream` built here,
 * so a generator body takes the same scope hold `jsonl` and `sse` already take — a page whose walk
 * reads `cookies()` after the handler returned is the failure that hold exists for.
 *
 * `identity` as the frame: a render already yields the strings, so there is nothing to encode.
 */
function bodyOf(
    body: string | ReadableStream<Uint8Array> | Values<string>,
): string | ReadableStream<Uint8Array> {
    if (typeof body === 'string') return body
    if (body instanceof ReadableStream) return heldStream(body)
    return heldFrames(body, (chunk) => chunk)
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
export function page(
    body: string | ReadableStream<Uint8Array> | Values<string>,
    init?: ResponseInit,
): Response {
    // Asked of every body, answered once: a render's stream already holds and comes straight back,
    // and an app streaming its own HTML through here gets the same guarantee without knowing there
    // was one to ask for. A string has no body to outlive the handler.
    //
    // Nothing here compresses. This entry point is BUNDLED FOR THE BROWSER — the dogfood app's server
    // suite renders in a card to compare the two substrates — so it cannot reach a compressor, and a
    // response that leaves an app's own route uncompressed would be a second rule to remember anyway.
    // `compressing` in the cli's `layers.ts` is the one place, and it reaches every `text/html`
    // answer rather than only the ones built here.
    return new Response(bodyOf(body), {
        ...init,
        headers: headersFor(init?.headers, PAGE_HEADERS),
    })
}

/**
 * What a rendered page says about itself when its route said nothing.
 *
 * `no-store` because a page here is rendered PER REQUEST and `identity()` is a first-class thing to
 * render off: with no directive at all a shared cache is free to invent a freshness lifetime, and the
 * response it invents one for may name whoever asked for it. `private` as well as `no-store` for the
 * intermediary that honours only one of them.
 *
 * A public page that wants a CDN says so — `headersFor` takes a caller's own `cache-control` over
 * this, which is what makes the safe direction the default and the fast one the decision.
 *
 * `referrer-policy` is the browsers' own default, written down: an older agent that defaults to
 * `no-referrer-when-downgrade` leaks a full authenticated path to every cross-origin image and link.
 *
 * `content-security-policy` is the half of the policy that cannot blank an app — see `ALWAYS_POLICY`.
 * `csp()` sets the whole header when an app installs it, and `set` there replaces this.
 */
const PAGE_HEADERS: Record<string, string> = {
    'content-type': HTML_TYPE,
    'cache-control': PRIVATE_NO_STORE,
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': ALWAYS_POLICY,
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
        // A refusal is about THIS call — a 403 is about who asked, a 404 about what they asked for
        // — and a cached one is answered to the next caller, who may be someone else entirely.
        headers: headersFor(extra, { 'content-type': JSON_TYPE, 'cache-control': PRIVATE_NO_STORE }),
    })
}

/**
 * A refusal from the mount point itself, under the one name every `/__abide/**` lane refuses with.
 *
 * The message does NOT name abide: it is wrapped as `abide: <address> — <message>` when it reaches a
 * caller, and a reader of the raw body has the address in the URL bar already.
 *
 * Beside `failed` rather than in `rpc.ts`, where it was declared and never called: the health
 * document, the identity document and the log feed all refuse with it, and none of them has anything
 * to do with the rpc declaration machinery they were importing it through.
 */
export function refuse(message: string, status: number, headers?: Record<string, string>): Response {
    return failed(TRANSPORT_ERROR, message, status, headers)
}
