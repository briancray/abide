// The failure an rpc travels as — on BOTH sides, as one class.
//
// `rpc = memo + transport`, and a memo's failure channel is a THROW. So a handler signals failure by
// throwing this; the memo routes it to its error channel with no special case, an in-process caller
// catches it, and TRANSPORT is what serializes it to a non-2xx response (server) and decodes a non-2xx
// back into it (browser proxy). One direction of that round trip used to be missing in each path: a
// handler that returned `error(404)` reached an in-process caller as a resolved `Response` VALUE — and
// on a read at `ttl: ∞` was then retained as that slot's value forever, so a transient upstream failure
// poisoned the cache permanently and `fn.error()` still reported `undefined` — while a handler that
// threw reached the wire flattened to a bare 500 with its status lost.
//
// `kind` (not `name`) carries a typed error's name, because `name` is the JS `Error` discriminator and
// stays `'HttpError'`; `isTypedError` — the predicate behind `fn.isError(e, name)` — accepts either, so
// both sides narrow identically on `kind` while a platform `DOMException` still narrows on `name`.

import { reasonPhrase } from './internal/reasonPhrase.ts'

// Every field admits an explicit `undefined` (`exactOptionalPropertyTypes`) so a caller can forward what
// it holds straight through — `outcomeResponse` and the browser proxy both rebuild one from fields that
// are legitimately absent, and re-deriving a default at each of those sites is how a second copy of this
// shape would grow.
export interface HttpErrorOptions {
    // A typed error's name (`error.typed(name, …)`) — what `fn.isError(e, name)` narrows on.
    kind?: string | undefined
    // A typed error's payload, carried onto the wire body and back.
    data?: unknown
    // Response headers this failure must carry (a 405's `Allow`, a 503's `Retry-After`).
    headers?: HeadersInit | undefined
    // Override the derived reason phrase.
    statusText?: string | undefined
}

export class HttpError extends Error {
    readonly status: number
    readonly statusText: string
    readonly kind?: string
    readonly data?: unknown
    readonly headers?: HeadersInit

    constructor(status: number, message?: string, options?: HttpErrorOptions) {
        const statusText = options?.statusText ?? reasonPhrase(status)
        super(message ?? (statusText === '' ? `HTTP ${status}` : statusText))
        this.name = 'HttpError'
        this.status = status
        this.statusText = statusText
        if (options?.kind !== undefined) this.kind = options.kind
        if (options?.data !== undefined) this.data = options.data
        if (options?.headers !== undefined) this.headers = options.headers
    }
}
