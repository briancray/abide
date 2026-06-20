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

    constructor(response: Response) {
        super(`HTTP ${response.status} ${response.statusText || 'error'}`)
        this.name = 'HttpError'
        this.status = response.status
        this.statusText = response.statusText
        this.response = response
    }
}
