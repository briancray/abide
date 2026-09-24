// SECTION 17 — THE RESPONSE HELPERS. Each is a write through `response` and hands back what it was
// given, so a handler returns the helper's call and its value type is unchanged: `page` names the
// document's type (17.2), `redirect` the status and the address (17.3), and the three stream helpers
// the framing (17.6) that nothing then negotiates past (17.7).

import { type Framing, response, within } from './requestScope.ts'

// 17.1.
export type Values<T> = Iterable<T> | AsyncIterable<T> | ReadableStream<T>

export type RedirectStatus = 301 | 302 | 303 | 307 | 308

// 17.2 — a rendered document: what `render` produced, not a render.
export function page<Body extends string | Values<Uint8Array | string>>(
    body: Body,
): Body {
    response().headers.set('content-type', 'text/html; charset=utf-8')
    within('page').framing = 'html'
    return body
}

// 17.3.
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

// 17.6.
export function jsonl<T>(values: Values<T>): Values<T> {
    return fixed('jsonl', values)
}

export function sse<T>(values: Values<T>): Values<T> {
    return fixed('sse', values)
}

export function bytes(values: Values<Uint8Array>): Values<Uint8Array> {
    return fixed('bytes', values)
}
