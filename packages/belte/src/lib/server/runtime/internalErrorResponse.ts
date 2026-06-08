import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'
import { isDebugEnabled } from '../../shared/isDebugEnabled.ts'

/*
The framework's default 500 response. Shared by the per-request scope's catch
(runWithRequestScope) and Bun.serve's global error() fallback so the two can't
drift. Only reached when the app supplies no `handleError` hook.

Secure by default: a bare `Internal Server Error` so paths, library versions,
and message contents never leak to clients in production. The full stack is
shown only under `DEBUG=belte` (the same dev signal that turns on request
logging); the cause is logged server-side regardless of the flag.
*/
export function internalErrorResponse(error: unknown): Response {
    const body = isDebugEnabled('belte')
        ? `<pre>${String((error as Error)?.stack ?? error)}</pre>`
        : 'Internal Server Error'
    return new Response(body, {
        status: 500,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': NO_STORE,
        },
    })
}
