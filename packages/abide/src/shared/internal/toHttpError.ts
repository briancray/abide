// Turn a non-2xx Response into the SAME `HttpError` the server threw — this is the decoding half of
// transport, and `error()` throwing that class on the server is the encoding half. The abide error body
// is `{ status, statusText, message, ... }` (or a typed-error body with `name`/`data`); fall back to the
// response status line when the body is not the expected JSON shape.
//
// It lives in `shared/internal` because BOTH sides decode: the browser RPC proxy, and the server's own
// loopback machine surfaces (`callOwnRpc` — MCP tools, `agent()` tools). The client used to carry a
// private look-alike of the CLASS, which is precisely how the two sides came to disagree; a second copy
// of the DECODER would drift the same way, one field at a time.

import { HttpError } from '../HttpError.ts'

export async function toHttpError(response: Response): Promise<HttpError> {
    let body: Record<string, unknown> | undefined
    try {
        const parsed = await response.json()
        if (parsed !== null && typeof parsed === 'object') body = parsed as Record<string, unknown>
    } catch {
        body = undefined
    }
    const status = typeof body?.status === 'number' ? body.status : response.status
    const statusText = typeof body?.statusText === 'string' ? body.statusText : response.statusText
    const message =
        typeof body?.message === 'string' ? body.message : statusText || `HTTP ${status}`
    const kind = typeof body?.name === 'string' ? body.name : undefined
    return new HttpError(status, message, { statusText, kind, data: body?.data })
}
