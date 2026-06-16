import { HttpError } from './HttpError.ts'
import { isStreamingResponse } from './isStreamingResponse.ts'

/*
Derives the error-prop contract — `{ status, message, stack }` — from an
unknown thrown value. Single-sources what both halves of the error boundary
encode: the server's renderPage catch and the client's showErrorView.

An HttpError carries the real status and its response body verbatim (the
`error(404, 'order not found')` text), so the boundary reports the honest
status and message — including the 503/504 a client RPC timeout/offline
synthesises — instead of flattening everything to 500. Any other throw is a
genuine server error → 500, with message/stack off the Error (else the value
stringified, stack omitted). Async because reading the response body is.
*/
export async function errorParamsForThrow(error: unknown): Promise<{
    status: number
    message: string
    stack: string | undefined
}> {
    if (error instanceof HttpError) {
        return {
            status: error.status,
            message: await messageFromError(error),
            /* The HttpError stack is the decode site, not a code bug — withhold it. */
            stack: undefined,
        }
    }
    return {
        status: 500,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    }
}

/*
The handler's `error(status, message)` text rides the response body; surface it
verbatim. Clone so the original body stays unread for any downstream reader,
and fall back to the `HTTP <status>` summary when the body is empty or already
consumed.
*/
async function messageFromError(error: HttpError): Promise<string> {
    /* A streaming body (SSE/JSONL) has no end to buffer — .text() would hang,
       so skip the read and use the status summary. */
    if (isStreamingResponse(error.response)) {
        return error.message
    }
    try {
        const text = await error.response.clone().text()
        return text.trim() === '' ? error.message : text
    } catch {
        return error.message
    }
}
