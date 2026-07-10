/*
Thrown by remote-function calls when the server responds with a non-2xx
status. Carries the raw Response so callers can inspect body, headers, or
status text — useful for showing user-friendly error UI without having to
opt every call site into the `.raw()` escape hatch.
*/
// @documentation response
export class HttpError extends Error {
    readonly status: number
    readonly statusText: string
    readonly response: Response
    /* Set when the handler returned a typed error (`error.typed(...)` constructor) or a
       validation 422: `kind` is the declared error name (or 'validation'), `data` the
       payload it carried — parsed off the `{ $abideError, data }` body by decodeResponse.
       `data` is typed `unknown` (a throw can't carry the rpc's per-kind type to the
       catch); narrow it yourself — for `kind: 'validation'` the shape is the exported
       `ValidationErrorData` (`{ issues, fields }`). Both undefined for a plain `error(status, text)`. */
    readonly kind?: string
    readonly data?: unknown

    constructor(response: Response, kind?: string, data?: unknown) {
        super(`HTTP ${response.status} ${response.statusText || 'error'}`)
        this.name = 'HttpError'
        this.status = response.status
        this.statusText = response.statusText
        this.response = response
        this.kind = kind
        this.data = data
    }
}
