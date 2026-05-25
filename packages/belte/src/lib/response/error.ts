/*
Plain-text error Response — clearer than constructing a Response by
hand with a status and a text body, and shaped so the client's
HttpError carries the message verbatim (`HttpError.response.text()`
returns the message, no parsing).

  if (!order) return error(404, 'order not found')

`message` defaults to the status's standard reason phrase when
omitted (e.g. `error(404)` body = 'Not Found'). The body is
text/plain so intermediaries don't try to render or sniff it.

To short-circuit a handler instead of returning, `throw new Error(...)`
or `throw new HttpError(error(...))` — the framework's `app.handleError`
hook catches thrown errors. This helper deliberately returns a Response
rather than throwing one so a single `return error(...)` is the
expected pattern, with the same control flow as `return json(...)`.
*/
const STATUS_TEXT: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    410: 'Gone',
    422: 'Unprocessable Content',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
}

export function error(status: number, message?: string): Response {
    const body = message ?? STATUS_TEXT[status] ?? `HTTP ${status}`
    return new Response(body, {
        status,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    })
}
