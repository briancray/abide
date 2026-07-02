/*
Standard reason phrases for the statuses abide sets explicitly. Bun's `Response`
does not populate `statusText` from the status code, so there's no platform table
to read. Unlisted codes fall back to `HTTP <status>` at the call site.
*/
export const STATUS_TEXT: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    410: 'Gone',
    413: 'Content Too Large',
    422: 'Unprocessable Content',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
}
