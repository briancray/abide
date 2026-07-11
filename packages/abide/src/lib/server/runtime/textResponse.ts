import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { TEXT_PLAIN } from '../../shared/TEXT_PLAIN.ts'
import { STATUS_TEXT } from './STATUS_TEXT.ts'

/*
The framework's plain-text status response — a `text/plain`, `no-store` body at
`status`, shared by the 404/405 dispatch branches, the asset servers' miss, and
the failed-upgrade reply so those literals can't drift. `body` defaults to the
status reason phrase (STATUS_TEXT, e.g. 'Not Found'), falling back to `HTTP
<status>` for an unlisted code. `extraHeaders` overlays the defaults per-key —
the 405 passes `Allow` this way. A fresh Response per call: a body is
single-use, so it can't be hoisted to a shared const.
*/
export function textResponse(
    status: number,
    body?: string,
    extraHeaders?: Record<string, string>,
): Response {
    return new Response(body ?? STATUS_TEXT[status] ?? `HTTP ${status}`, {
        status,
        headers: { 'Content-Type': TEXT_PLAIN, 'Cache-Control': NO_STORE, ...extraHeaders },
    })
}
