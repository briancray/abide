import { NO_STORE } from '../../shared/CACHE_CONTROL_VALUES.ts'

/*
The framework's default 500 response. Shared by the per-request scope's catch
(runWithRequestScope) and Bun.serve's global error() fallback so the two can't
drift. Only reached when the app supplies no `handleError` hook.

Secure by default: a bare `Internal Server Error` so paths, library versions,
and message contents never leak to clients in production. The full stack is
shown only under `belte dev` (BELTE_DEV=1, the orchestrator's signal); the
cause is logged server-side regardless.
*/
export function internalErrorResponse(error: unknown): Response {
    const body =
        Bun.env.BELTE_DEV === '1'
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
