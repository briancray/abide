// SECTION 17 — THE RESPONSE HELPERS. Each is a write through `response` and hands back what it was
// given, so a handler returns the helper's call and its value type is unchanged: `page` names the
// document's type (17.2), `json` the serialization (17.9), `redirect` the status and the address
// (17.3), and the three stream helpers the framing (17.6) that nothing then negotiates past (17.7).

import { type Framing, response, within } from './requestScope.ts'

/**
 * What a stream helper frames: an iterable, an async iterable or a stream of values.
 *
 * 17.1.
 */
export type Values<T> = Iterable<T> | AsyncIterable<T> | ReadableStream<T>

export type RedirectStatus = 301 | 302 | 303 | 307 | 308

/**
 * Marks the answer as an HTML document and returns `body` unchanged.
 *
 * 17.2 — a rendered document: what `render` produced, not a render.
 */
export function page<
    Body extends string | Uint8Array | Values<Uint8Array | string>,
>(body: Body): Body {
    response().headers.set('content-type', 'text/html; charset=utf-8')
    within('page').framing = 'html'
    return body
}

/**
 * Fixes the answer as JSON and returns `value` unchanged.
 *
 * 17.9, 17.10 — the serialization a bare return gets, with nothing negotiated past it and an
 * `undefined` sent as `null` rather than as 204.
 */
export function json<T>(value: T): T {
    within('json').framing = 'json'
    return value
}

/**
 * Sets the response's redirect status and `location`, and returns `undefined`.
 *
 * 17.3.
 */
export function redirect(to: string, status: RedirectStatus = 302): undefined {
    const written = response()
    written.status = status
    written.headers.set('location', to)
    return undefined
}

function fixed<T>(framing: Framing, values: T): T {
    within(framing).framing = framing
    return values
}

/**
 * Fixes the answer's framing to JSON lines and returns `values` unchanged.
 *
 * 17.6.
 */
export function jsonl<T>(values: Values<T>): Values<T> {
    return fixed('jsonl', values)
}

/** Fixes the answer's framing to server-sent events and returns `values` unchanged. 17.6. */
export function sse<T>(values: Values<T>): Values<T> {
    return fixed('sse', values)
}

/** Fixes the answer's framing to raw bytes and returns `values` unchanged. 17.6. */
export function bytes(values: Values<Uint8Array>): Values<Uint8Array> {
    return fixed('bytes', values)
}
