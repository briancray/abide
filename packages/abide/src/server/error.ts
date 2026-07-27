// Error response helpers (rpc-core §4). `error(status, message?)` produces a JSON error
// body; `error.typed(name, status, schema?)` builds a reusable factory for a named,
// narrowable error whose body carries the type name + payload plus a runtime marker.

import type { OutcomeResponse } from '../shared/internal/responseSource.ts'

// Canonical HTTP reason phrases. Bun's Response does not auto-populate statusText from a
// status code, so we carry the common table ourselves; unknown codes fall back to "".
const STATUS_TEXT: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Payload Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    418: "I'm a Teapot",
    422: 'Unprocessable Entity',
    425: 'Too Early',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
}

function reasonPhrase(status: number): string {
    return STATUS_TEXT[status] ?? ''
}

function jsonResponse(status: number, body: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(body), { ...init, status, headers })
}

// Both forms are typed as an `OutcomeResponse` — still an ordinary `Response` everywhere one is taken,
// but marked as an outcome rather than a value. A failure reaches the caller as a thrown `HttpError`,
// never as the resolved value, so a handler with a failing branch keeps its success payload clean
// (`{#await fn()}{:then v}` can reach a field of `v`) instead of inferring `Response | T`.
export const error: {
    (status: number, message?: string, init?: ResponseInit): OutcomeResponse
    typed(
        name: string,
        status: number,
        schema?: unknown,
    ): (data?: unknown) => OutcomeResponse & { __typedErrorName: string }
} = Object.assign(
    (status: number, message?: string, init?: ResponseInit): OutcomeResponse => {
        const statusText = reasonPhrase(status)
        return jsonResponse(
            status,
            { status, statusText, message: message ?? statusText },
            init,
        ) as OutcomeResponse
    },
    {
        typed(
            name: string,
            status: number,
            _schema?: unknown,
        ): (data?: unknown) => OutcomeResponse & { __typedErrorName: string } {
            return (data?: unknown): OutcomeResponse & { __typedErrorName: string } => {
                const statusText = reasonPhrase(status)
                // `__typedError` is the in-body marker; the name/data are the narrowable payload.
                const body = { status, statusText, error: name, name, data, __typedError: name }
                const response = jsonResponse(status, body) as OutcomeResponse & {
                    __typedErrorName: string
                }
                // Object marker on the Response instance so the router/client can narrow synchronously.
                response.__typedErrorName = name
                return response
            }
        },
    },
)
