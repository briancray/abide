// Redirect helper (rpc-core §4). Sets Location and a 3xx status (default 302).
//
// THROWS a `Redirect` rather than returning a `Response`, for the same reason `error()` throws: a handler
// that redirects produced no value, so it must not resolve as one. Returning it meant an in-process
// caller got the `Response` as the slot's VALUE (and a read retained it), and `Payload<R>` needed an
// `OutcomeResponse` brand to keep it out of the handler's success type. A `throw` is `never`, which a
// union absorbs on its own — so the brand retired with it. The router catches it and renders the 3xx.

import { Redirect } from '../shared/Redirect.ts'

export function redirect(
    url: string,
    status: 301 | 302 | 303 | 307 | 308 = 302,
    init?: { headers?: HeadersInit },
): never {
    throw new Redirect(url, status, init?.headers)
}
