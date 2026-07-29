// Canonical HTTP reason phrases. Bun's `Response` does not auto-populate `statusText` from a status
// code, so we carry the common table ourselves; unknown codes fall back to "".
//
// Isomorphic by placement: `HttpError` is thrown on the server and re-thrown by the browser proxy after
// decoding a non-2xx, and both need the same phrase for the same code — a copy on either side is a copy
// that can drift.

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
    422: 'Unprocessable Content', // RFC 9110's name for it; RFC 4918 called it "Unprocessable Entity"
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

export function reasonPhrase(status: number): string {
    return STATUS_TEXT[status] ?? ''
}
