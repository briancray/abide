// The navigation a handler leaves through, as a throw.
//
// A redirect is NOT an error, so it is its own class rather than a 3xx `HttpError` — but it leaves the
// value channel the same way one does, because a handler that redirects has produced no value and must
// not resolve as one. Returning it as a `Response` had the same two failure modes `HttpError` documents:
// an in-process caller resolved the `Response` as the slot's VALUE (and a read retained it), and
// `Payload<R>` needed an `OutcomeResponse` brand to keep that `Response` out of the handler's success
// type. Throwing needs neither — a `throw` is `never`, which a union absorbs on its own.

export class Redirect extends Error {
    readonly url: string
    readonly status: 301 | 302 | 303 | 307 | 308
    readonly headers?: HeadersInit

    constructor(url: string, status: 301 | 302 | 303 | 307 | 308 = 302, headers?: HeadersInit) {
        super(`Redirect ${status} to ${url}`)
        this.name = 'Redirect'
        this.url = url
        this.status = status
        if (headers !== undefined) this.headers = headers
    }
}
