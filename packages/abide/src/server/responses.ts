// The shapes an app's OWN route answers with, and the one it throws.
//
// abide serves `/__abide/**` through `dispatch`; every other path is the app's, and a route there
// hands back an ordinary `Response`. So does each of these — nothing here is a framework object a
// caller has to unwrap, which is what lets a handler that outgrows them drop to `new Response(...)`
// and lose nothing.
//
// `error` is the exception, and it throws for a reason a return could not serve: an rpc handler's
// return type is its VALUE, so a failure has nowhere to go but out. Declared `never`, so the checker
// treats what follows a call as unreachable and narrows the value the caller was guarding.

import { framedBody, JSON_TYPE, jsonLine } from '$shared/internal/wire.ts'

/** One JSON value per line. JSON has no unescaped newline, so the delimiter needs no length prefix. */
const JSONL_TYPE = 'application/jsonl'
const SSE_TYPE = 'text/event-stream'

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

/**
 * A failure with a status on it, which is what `respond` reads to answer with something other than
 * a 500.
 *
 * The kind is also assigned to `name`, and that is the copy that matters: `name` is what crosses the
 * wire, what `isError` matches, and what prefixes a stack line — a typed failure that left `name` as
 * `'HttpError'` would be anonymous everywhere it travelled. `kind` is the local spelling, for a
 * server-side reader holding the real error rather than the plain object a wire delivers.
 */
export class HttpError extends Error {
    readonly status: number
    readonly kind: string

    constructor(kind: string, message: string, status: number, options?: ErrorOptions) {
        super(message, options)
        this.kind = kind
        this.status = status
        this.name = kind
    }
}

/** A named failure, as many times as an app needs it. Carries its own `kind` so no caller retypes it. */
export interface Failure {
    (message: string, options?: ErrorOptions): never
    readonly kind: string
    readonly status: number
}

/**
 * Fail this call.
 *
 * `never`, so `error('no user', 404)` reads as a statement and the checker knows the line after it
 * is unreachable — a guard, not a value someone has to remember to `throw`. `throw error(...)` is
 * still valid and does the same thing.
 */
export function error(message: string, status = 500, options?: ErrorOptions): never {
    throw new HttpError('HttpError', message, status, options)
}

/**
 * A reusable failure with a NAME on it: `const notFound = error.typed('NotFound', 404)`.
 *
 * The name is the whole point of declaring one. An error that crossed a wire arrives as a plain
 * object, so `instanceof` on it is false however faithfully it was serialised — `isError(e, 'NotFound')`
 * is the question that survives the trip, and it asks about the name this puts there.
 */
error.typed = function typed(kind: string, status = 500): Failure {
    const failure = ((message: string, options?: ErrorOptions): never => {
        throw new HttpError(kind, message, status, options)
    }) as Failure
    Object.defineProperty(failure, 'kind', { value: kind, enumerable: true })
    Object.defineProperty(failure, 'status', { value: status, enumerable: true })
    return failure
}
