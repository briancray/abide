import { NO_STORE } from '../../shared/cacheControlValues.ts'

/*
The framework's default 500 response — a `<pre>` stack dump. Shared by the
per-request scope's catch (runWithRequestScope) and Bun.serve's global
error() fallback so the two can't drift. Only reached when the app supplies
no `handleError` hook.
*/
export function internalErrorResponse(error: unknown): Response {
    return new Response(`<pre>${String((error as Error)?.stack ?? error)}</pre>`, {
        status: 500,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': NO_STORE,
        },
    })
}
